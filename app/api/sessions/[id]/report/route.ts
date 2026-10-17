import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/db/repository";
import { listSessionEvents, verifyEventHash } from "@/lib/events/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid scan ID" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const session = await getSession(supabase, id);
    if (!session) return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    const [rounds, verifications, patches, events] = await Promise.all([
      supabase.from("scan_rounds").select("round_number,checks,clean,verified_finding_count,summary,evidence_hash,recorded_at").eq("scan_id", id).order("round_number"),
      supabase.from("verification_runs").select("id,check_type,status,verifier_version,evidence_ids,detail,recorded_at").eq("scan_id", id).order("recorded_at").limit(100),
      supabase.from("patches").select("id,file_path,diff,rationale,regression_test,patch_hash,status,sandbox_run_status,approved_by,approved_at,created_at").eq("scan_id", id).order("created_at").limit(50),
      listSessionEvents(supabase, id, 0, 200),
    ]);
    if (rounds.error || verifications.error || patches.error) return NextResponse.json({ error: "Some report evidence is unavailable" }, { status: 503 });
    const integrity = events.length > 0 && events.every(verifyEventHash);
    return NextResponse.json({ session, rounds: rounds.data ?? [], verifications: verifications.data ?? [], patches: patches.data ?? [], events, auditIntegrity: integrity }, { headers: { "cache-control": "no-store" } });
  } catch { return NextResponse.json({ error: "Final report is unavailable" }, { status: 503 }); }
}
