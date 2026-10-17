import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createTarget } from "@/lib/db/repository";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizePublicGitHubRepo } from "@/lib/intake/github";
import { RequestTooLargeError, readBoundedFormData } from "@/lib/security/bounded-form";
import { parseAuthorizedOrigin, isPathInScope, resolvePublicTarget } from "@/lib/security/target-scope";
import { IntakeRequestSchema } from "@/lib/schemas/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_ARCHIVE_BYTES + 1024 * 1024;
const ScopePathsSchema = z.array(z.string().min(1).max(512)).min(1).max(50);
const UUID = z.string().uuid();

function parseScopePaths(raw: string) {
  let values: unknown;
  try { values = JSON.parse(raw) as unknown; } catch { throw new Error("Scope paths must be a JSON array"); }
  const scopePaths = ScopePathsSchema.parse(values);
  return [...new Set(scopePaths.map((path) => {
    let decoded: string;
    try { decoded = decodeURIComponent(path); } catch { throw new Error("Scope path has malformed encoding"); }
    if (!path.startsWith("/") || path.startsWith("//") || /[?#\\\u0000-\u001f\u007f]/.test(decoded) || decoded.split("/").some((segment) => segment === "." || segment === "..")) throw new Error("Scope paths must be absolute prefixes without traversal, query, fragment, or controls");
    return path;
  }))];
}
function cleanLabel(value: string) { return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160) || "Authorized target"; }
function zodErrorMessage(error: z.ZodError) { return error.issues.map((issue) => issue.message).slice(0, 4).join("; "); }

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const form = await readBoundedFormData(request, MAX_FORM_BYTES);
    const parsed = IntakeRequestSchema.safeParse({
      kind: form.get("kind"), authorizationConfirmed: form.get("authorizationConfirmed"), authorizationPhrase: form.get("authorizationPhrase"),
      scopePaths: form.get("scopePaths"), projectId: form.get("projectId"),
      ...(typeof form.get("url") === "string" ? { url: form.get("url") as string } : {}),
      ...(typeof form.get("repoUrl") === "string" ? { repoUrl: form.get("repoUrl") as string } : {}),
    });
    if (!parsed.success) return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
    const input = parsed.data;
    if (!UUID.safeParse(input.projectId).success) return NextResponse.json({ error: "A valid workspace is required" }, { status: 400 });
    const scopePaths = parseScopePaths(input.scopePaths);
    let label = ""; let origin: string | undefined; let accessMode: "source" | "url-only" = "source";
    let sourceReference: string | undefined; let sourceHash: string | undefined;

    if (input.kind === "archive") {
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Choose a ZIP file or source folder" }, { status: 400 });
      if (!file.name.toLowerCase().endsWith(".zip") || file.size < 4 || file.size > MAX_ARCHIVE_BYTES) return NextResponse.json({ error: "Source must be a ZIP between 4 bytes and 20 MiB" }, { status: 413 });
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return NextResponse.json({ error: "Selected source is not a ZIP archive" }, { status: 400 });
      sourceHash = createHash("sha256").update(bytes).digest("hex"); label = cleanLabel(file.name.replace(/\.zip$/i, ""));
    } else if (input.kind === "github") {
      if (!input.repoUrl) return NextResponse.json({ error: "Provide a public GitHub repository URL" }, { status: 400 });
      const repo = normalizePublicGitHubRepo(input.repoUrl); label = cleanLabel(`${repo.owner}/${repo.repository}`); sourceReference = repo.url;
    } else {
      if (!input.url) return NextResponse.json({ error: "Provide an HTTPS website URL" }, { status: 400 });
      const normalized = parseAuthorizedOrigin(input.url);
      if (!isPathInScope(normalized.url.pathname, scopePaths)) return NextResponse.json({ error: "Requested path is outside declared scope" }, { status: 400 });
      await resolvePublicTarget(input.url); origin = normalized.origin; sourceReference = normalized.url.toString(); accessMode = "url-only"; label = cleanLabel(normalized.hostname);
    }

    const target = await createTarget(supabase, {
      projectId: input.projectId, ownerId: user.id, kind: input.kind, label, ...(origin ? { origin } : {}), scopePaths, accessMode,
      ...(sourceHash ? { sourceHash } : {}), ...(sourceReference ? { sourceReference } : {}), authorizationConfirmed: true, authorizationPhrase: "I AM AUTHORIZED",
    });
    return NextResponse.json({ target: { id: target.id, kind: target.kind, label: target.label, ...(target.origin ? { origin: target.origin } : {}), accessMode: target.accessMode, ...(target.sourceHash ? { sourceHash: target.sourceHash } : {}), projectId: target.projectId, createdAt: target.createdAt } }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: zodErrorMessage(error) }, { status: 400 });
    const message = error instanceof Error ? error.message : "Target intake failed";
    return NextResponse.json({ error: message.slice(0, 250) }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
