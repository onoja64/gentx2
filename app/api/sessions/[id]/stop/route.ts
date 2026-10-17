import { NextResponse } from "next/server";
import { getClient } from "@/lib/createos/client";
import { getSession, setSessionSandboxId, setSessionStatus } from "@/lib/db/repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { abortSessionRun } from "@/lib/runner/active";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid scan ID" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const existing = await getSession(supabase, id);
    if (!existing) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    if (["stopped", "completed", "blocked", "failed"].includes(existing.status)) return NextResponse.json({ session: existing }, { headers: { "cache-control": "no-store" } });
    const admin = createSupabaseAdminClient();
    await setSessionStatus(admin, id, "stopped", "Operator stop requested", "STOP_REQUESTED", { operatorRequested: true, requestedBy: user.id });
    abortSessionRun(id);
    if (existing.sandboxId) {
      const client = getClient();
      const sandbox = await client.getSandbox(existing.sandboxId);
      if (sandbox.status !== "destroyed" && sandbox.status !== "failed") {
        await sandbox.destroy({ timeoutMs: 15_000, retry: false });
        await sandbox.waitUntilDestroyed({ timeoutMs: 90_000, request: { timeoutMs: 15_000, retry: false } });
      }
      await setSessionSandboxId(admin, id, null);
    }
    return NextResponse.json({ session: await getSession(supabase, id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    return NextResponse.json({ error: `Stop cleanup requires attention (${errorName})` }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
