import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getSession } from "@/lib/db/repository";
import { listSessionEvents, verifyEventHash } from "@/lib/events/audit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportPageProps = { params: Promise<{ id: string }> };

export default async function SessionReportPage({ params }: ReportPageProps) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try { supabase = await createSupabaseServerClient(); }
  catch { redirect("/login"); }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession(supabase, id);
  } catch {
    return <AppShell userEmail={user.email ?? "operator"}><main className="mx-auto max-w-5xl px-4 py-10"><Card className="p-6"><h1 className="mono text-lg">Report unavailable</h1><p className="mt-2 text-sm text-muted-foreground">The session could not be loaded from authorized database records.</p><Link href="/" className="mt-4 inline-block text-sm text-primary">Back to operations</Link></Card></main></AppShell>;
  }
  if (!session) notFound();

  let rounds: Array<Record<string, any>>;
  let verifications: Array<Record<string, any>>;
  let patches: Array<Record<string, any>>;
  let events;
  try {
    const results = await Promise.all([
      supabase.from("scan_rounds").select("round_number,checks,clean,verified_finding_count,summary,evidence_hash,recorded_at").eq("scan_id", id).order("round_number"),
      supabase.from("verification_runs").select("id,check_type,status,verifier_version,evidence_ids,detail,recorded_at").eq("scan_id", id).order("recorded_at").limit(100),
      supabase.from("patches").select("id,file_path,diff,rationale,regression_test,patch_hash,status,sandbox_run_status,approved_by,approved_at,created_at").eq("scan_id", id).order("created_at").limit(50),
    ]);
    if (results.some((result) => result.error)) throw new Error("Report data query failed");
    [rounds, verifications, patches] = results.map((result) => result.data ?? []);
    events = await listSessionEvents(supabase, id, 0, 200);
  } catch {
    return <AppShell userEmail={user.email ?? "operator"}><main className="mx-auto max-w-5xl px-4 py-10"><Card className="p-6"><h1 className="mono text-lg">Report unavailable</h1><p className="mt-2 text-sm text-muted-foreground">The session report could not be loaded from authorized database records.</p><Link href="/" className="mt-4 inline-block text-sm text-primary">Back to operations</Link></Card></main></AppShell>;
  }

  const eventHashesValid = events.length > 0 && events.every(verifyEventHash);
  const statusTone = session.status === "completed" ? "verified" : session.status === "failed" ? "risk" : "pending";

  return <AppShell userEmail={user.email ?? "operator"}>
    <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><Link href="/" className="mono text-[9px] text-primary">← OPERATIONS</Link><h1 className="mt-3 mono text-xl font-semibold">Session report</h1><p className="mt-1 text-xs text-muted-foreground">{session.targetLabel} · {new Date(session.createdAt).toLocaleString()}</p></div>
        <div className="flex items-center gap-2"><Badge variant={statusTone}>{session.status.toUpperCase()}</Badge><a href={`/api/sessions/${encodeURIComponent(id)}/report`} className="rounded border border-border px-3 py-2 mono text-[9px] text-foreground/80 hover:bg-white/[0.04]">Download report JSON</a></div>
      </div>

      <Card className="grid gap-4 p-4 sm:grid-cols-4">
        <div><div className="eyebrow text-muted-foreground">Trusted state</div><div className="mt-2 mono text-sm">{session.state ?? "—"}</div></div>
        <div><div className="eyebrow text-muted-foreground">Round</div><div className="mt-2 mono text-sm">{session.round}</div></div>
        <div><div className="eyebrow text-muted-foreground">Clean streak</div><div className="mt-2 mono text-sm">{session.consecutiveCleanRounds} / 3</div></div>
        <div><div className="eyebrow text-muted-foreground">Audit event hashes</div><div className="mt-2 mono text-sm">{eventHashesValid ? "VALID" : "UNAVAILABLE / INVALID"}</div></div>
        {session.stopReason && <p className="sm:col-span-4 rounded border border-amber-300/20 bg-amber-300/[0.04] p-3 text-xs text-amber-100">{session.stopReason}</p>}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border/70 px-4 py-3"><h2 className="mono text-[10px] font-semibold">FINDINGS</h2></div>
        {session.findings.length ? <ul className="divide-y divide-border/50">{session.findings.map((finding) => <li key={finding.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{finding.title}</strong><Badge variant={finding.status === "verified" ? "verified" : "pending"}>{finding.severity.toUpperCase()} · {finding.status.toUpperCase()}</Badge></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{finding.summary}</p></li>)}</ul> : <p className="p-4 text-xs text-muted-foreground">No findings were persisted for this session.</p>}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border/70 px-4 py-3"><h2 className="mono text-[10px] font-semibold">ROUND CHECKS</h2></div>
        {rounds.length ? <div className="divide-y divide-border/50">{rounds.map((round) => <section key={round.round_number} className="space-y-2 p-4"><div className="flex items-center justify-between"><strong className="mono text-xs">ROUND {round.round_number}</strong><Badge variant={round.clean ? "verified" : "pending"}>{round.clean ? "CLEAN GATES PASSED" : "NOT CLEAN"}</Badge></div><p className="text-xs text-muted-foreground">{round.summary}</p><pre className="overflow-auto rounded bg-black/30 p-3 mono text-[10px]">{JSON.stringify(round.checks, null, 2)}</pre><p className="mono text-[9px] text-muted-foreground">Evidence hash: {round.evidence_hash}</p></section>)}</div> : <p className="p-4 text-xs text-muted-foreground">No round results were persisted.</p>}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border/70 px-4 py-3"><h2 className="mono text-[10px] font-semibold">VERIFICATION RUNS</h2></div>
        {verifications.length ? <ul className="divide-y divide-border/50">{verifications.map((run) => <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 p-4"><span className="text-xs">{run.check_type}</span><Badge variant={run.status === "pass" ? "verified" : run.status === "fail" ? "risk" : "pending"}>{run.status.toUpperCase()}</Badge><p className="w-full text-xs text-muted-foreground">{run.detail}</p></li>)}</ul> : <p className="p-4 text-xs text-muted-foreground">No verification runs were persisted.</p>}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border/70 px-4 py-3"><h2 className="mono text-[10px] font-semibold">PATCH PROPOSALS</h2></div>
        {patches.length ? <div className="divide-y divide-border/50">{patches.map((patch) => <section key={patch.id} className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="mono text-xs">{patch.file_path}</strong><Badge variant={patch.sandbox_run_status === "pass" ? "verified" : patch.sandbox_run_status === "fail" ? "risk" : "pending"}>{patch.sandbox_run_status === "pass" ? "SANDBOX PASS" : patch.sandbox_run_status === "fail" ? "SANDBOX FAIL" : patch.status.toUpperCase()}</Badge></div><p className="text-xs leading-relaxed text-muted-foreground">{patch.rationale}</p><pre className="max-h-80 overflow-auto rounded bg-black/30 p-3 mono text-[10px] leading-relaxed">{patch.diff}</pre><div><div className="eyebrow mb-1">Reviewed regression script</div><pre className="max-h-56 overflow-auto rounded bg-black/30 p-3 mono text-[10px] leading-relaxed">{patch.regression_test}</pre></div><p className="text-[10px] text-muted-foreground">A passing script records its exit status only. The finding remains unverified and the original repository was not changed.</p><p className="mono text-[9px] text-muted-foreground">SHA-256 {patch.patch_hash}</p></section>)}</div> : <p className="p-4 text-xs text-muted-foreground">No patch proposals were persisted.</p>}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border/70 px-4 py-3"><h2 className="mono text-[10px] font-semibold">AUDIT EVENTS</h2></div>
        {events.length ? <ol className="divide-y divide-border/50">{events.map((event) => <li key={event.event_id} className="grid gap-2 p-3 sm:grid-cols-[150px_1fr]"><time className="mono text-[9px] text-muted-foreground">{new Date(event.created_at).toLocaleString()}</time><div><div className="mono text-[10px] text-primary">#{event.sequence} · {event.actor} · {event.type}</div><pre className="mt-1 whitespace-pre-wrap break-words mono text-[9px] text-muted-foreground">{JSON.stringify(event.payload, null, 2)}</pre></div></li>)}</ol> : <p className="p-4 text-xs text-muted-foreground">No audit events were available.</p>}
      </Card>
    </main>
  </AppShell>;
}
