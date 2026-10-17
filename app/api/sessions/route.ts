import { after, NextResponse } from "next/server";
import { createSession, getTarget, listSessions, recordSourceHash, setSessionStatus } from "@/lib/db/repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { downloadPublicGitHubArchive, sha256 } from "@/lib/intake/github";
import { RequestTooLargeError, readBoundedFormData } from "@/lib/security/bounded-form";
import { resolvePublicTarget, isPathInScope } from "@/lib/security/target-scope";
import { runSession } from "@/lib/runner/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_ARCHIVE_BYTES + 1024 * 1024;

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) return NextResponse.json({ error: "A valid workspace is required" }, { status: 400 });
  try { return NextResponse.json({ sessions: await listSessions(supabase, projectId, 50) }, { headers: { "cache-control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Project-scoped session history is unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  let scanId: string | null = null;
  try {
    const form = await readBoundedFormData(request, MAX_FORM_BYTES);
    const targetId = form.get("targetId"); const projectId = form.get("projectId");
    if (typeof targetId !== "string" || !/^[0-9a-f-]{36}$/i.test(targetId) || typeof projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(projectId) || form.get("authorizationConfirmed") !== "true") return NextResponse.json({ error: "Valid workspace, target ID, and explicit engagement authorization are required" }, { status: 400 });
    const target = await getTarget(supabase, targetId);
    if (!target || target.projectId !== projectId || !target.authorizationConfirmed || target.authorizationPhrase !== "I AM AUTHORIZED") return NextResponse.json({ error: "Target authorization or workspace membership could not be verified" }, { status: 403 });

    let sourceArchive: Uint8Array | null = null; let targetUrl: string | null = null; let egressRules: string[]; let sourceHash: string | null = null;
    const sourceAnalysisConsented = form.get("sourceAnalysisConsented") === "true";
    if (sourceAnalysisConsented && target.accessMode !== "source") return NextResponse.json({ error: "Source analysis consent is only available for source-backed targets" }, { status: 400 });
    if (target.accessMode === "url-only") {
      if (!target.sourceReference || !target.origin) throw new Error("URL-only target lacks its authorized origin");
      const resolved = await resolvePublicTarget(target.sourceReference);
      if (resolved.origin !== target.origin || !isPathInScope(new URL(target.sourceReference).pathname, target.scopePaths)) throw new Error("Target URL no longer matches the authorized scope");
      targetUrl = target.sourceReference; egressRules = resolved.egressRules;
    } else if (target.kind === "archive") {
      const file = form.get("sourceArchive");
      if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".zip") || file.size < 4 || file.size > MAX_ARCHIVE_BYTES) return NextResponse.json({ error: "Re-select the authorized ZIP/folder source (maximum 20 MiB) before starting" }, { status: 400 });
      sourceArchive = new Uint8Array(await file.arrayBuffer());
      if (sourceArchive[0] !== 0x50 || sourceArchive[1] !== 0x4b) throw new Error("Source upload is not a ZIP archive");
      sourceHash = await sha256(sourceArchive);
      if (target.sourceHash && target.sourceHash !== sourceHash) throw new Error("Source changed after authorization; create a new target record");
      egressRules = ["127.0.0.1:4177"];
    } else {
      if (!target.sourceReference) throw new Error("GitHub target lacks its authorized source reference");
      const downloaded = await downloadPublicGitHubArchive(target.sourceReference, AbortSignal.timeout(25_000));
      sourceArchive = downloaded.archive;
      sourceHash = downloaded.sourceHash;
      await recordSourceHash(createSupabaseAdminClient(), target.id, sourceHash);
      egressRules = ["127.0.0.1:4177"];
    }
    if (!egressRules.length || egressRules.some((rule) => rule === "*" || !rule.trim())) throw new Error("Explicit non-empty CreateOS egress rules are required");
    const session = await createSession(supabase, target, user.id, { sourceHash, sourceAnalysisConsented });
    if (!session) throw new Error("Session record was not created");
    scanId = session.id;
    const runInput = { sessionId: session.id, targetId: target.id, projectId: target.projectId, ownerId: user.id, sourceArchive, egressRules, targetUrl, scopePaths: target.scopePaths, accessMode: target.accessMode };
    after(async () => { await runSession(runInput); });
    return NextResponse.json({ session }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (scanId) { try { await setSessionStatus(createSupabaseAdminClient(), scanId, "blocked", "Session runner could not be scheduled", "SESSION_BLOCKED", { reason: "schedule-failure" }); } catch { /* preserve original failure */ } }
    if (error instanceof RequestTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    const name = error instanceof Error ? error.name : "UnknownError";
    const known = error instanceof Error && /^(?:The |Only |Use |Target |Scope |Malformed |Path |GitHub |Public |Repository |Source |Re-select|An explicit|URL-only)/.test(error.message) ? error.message.slice(0, 240) : `Session intake failed (${name})`;
    return NextResponse.json({ error: known }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
