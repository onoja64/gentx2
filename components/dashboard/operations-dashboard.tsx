"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { Activity, ArrowDownRight, ArrowUpRight, Ban, CheckCircle2, CircleDot, Clock3, FileText, Gauge, LoaderCircle, Plus, Shield, ShieldCheck, ShieldEllipsis, StopCircle, Target, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/dashboard/app-shell";
import { AgentPanel, type AgentActivity, type AgentRole } from "@/components/dashboard/agent-panel";
import { LiveEvents, type SessionEvent } from "@/components/dashboard/live-events";
import { SandboxHealth, type SandboxSnapshot } from "@/components/dashboard/sandbox-health";
import { StateMachine, type WorkflowState } from "@/components/dashboard/state-machine";
import { TargetIntake, type TargetSummary } from "@/components/intake/target-intake";
import { PatchDiff, type PatchView } from "@/components/findings/patch-diff";
import { VerifiedFindings, type FindingView } from "@/components/findings/verified-findings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface SessionSummary {
  id: string;
  targetId: string;
  targetKind?: "archive" | "github" | "url";
  targetAccessMode?: "source" | "url-only";
  targetLabel: string;
  status: "ready" | "running" | "blocked" | "stopped" | "completed" | "failed";
  state: WorkflowState | null;
  round: number;
  consecutiveCleanRounds: number;
  createdAt: string;
  stopReason?: string;
  findings?: FindingView[];
}

type CheckStatus = "pass" | "fail" | "inconclusive" | "not-run" | "pending";
interface RoundChecksView {
  noNewVerifiedFindings: CheckStatus;
  regression: CheckStatus;
  previousExploitReplay: CheckStatus;
  independentVerification: CheckStatus;
}

function Metric({ label, value, detail, icon: Icon, tone = "neutral" }: { label: string; value: string; detail: string; icon: ComponentType<{ className?: string }>; tone?: "neutral" | "green" | "cyan" | "amber" }) {
  const iconTone = tone === "green" ? "text-[var(--terminal-green)]" : tone === "cyan" ? "text-[var(--aqua)]" : tone === "amber" ? "text-amber-200" : "text-muted-foreground";
  return <Card className="terminal-panel p-3.5 sm:p-4"><div className="flex items-center justify-between"><span className="eyebrow text-muted-foreground">{label}</span><Icon className={`size-3.5 ${iconTone}`} /></div><div className="mt-3 flex items-end justify-between gap-2"><div className="mono text-[20px] font-medium leading-none tracking-[-.04em] text-foreground">{value}</div><span className="text-right text-[8px] leading-relaxed text-muted-foreground">{detail}</span></div></Card>;
}

function statusLabel(status: CheckStatus) {
  return status === "not-run" ? "NOT RUN" : status.toUpperCase();
}

function statusClass(status: CheckStatus) {
  return status === "pass" ? "text-[var(--terminal-green)]" : status === "fail" ? "text-rose-200" : status === "inconclusive" ? "text-amber-200" : "text-muted-foreground/65";
}

function RoundReadiness({ session, checks }: { session?: SessionSummary | null; checks?: RoundChecksView }) {
  const clean = session?.consecutiveCleanRounds ?? null;
  const blocked = session?.status === "blocked";
  const rows: Array<[keyof RoundChecksView, string]> = [
    ["noNewVerifiedFindings", "No new verified findings"],
    ["regression", "Regression tests pass"],
    ["previousExploitReplay", "Prior exploits fail on replay"],
    ["independentVerification", "Independent verifier succeeds"],
  ];
  return (
    <Card className="terminal-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/65 px-4 py-3.5"><div className="flex items-center gap-2"><Gauge className="size-3.5 text-[var(--aqua)]" /><h2 className="mono text-[10px] font-semibold">ROUND READINESS</h2></div><Badge variant={blocked ? "pending" : "outline"}>{blocked ? "BLOCKED" : session?.status ? session.status.toUpperCase() : "IDLE"}</Badge></div>
      <div className="space-y-3 p-4">
        <div className="flex items-baseline justify-between"><span className="text-[9px] text-muted-foreground">Consecutive clean rounds</span><span className="mono text-[12px] text-foreground">{clean === null ? "—" : `${clean} / 3`}</span></div>
        <div className="flex gap-1.5" aria-label="Three consecutive clean rounds required">{[0, 1, 2].map((index) => <div key={index} className={`h-1.5 flex-1 rounded-full ${clean !== null && index < clean ? "bg-[var(--terminal-green)] shadow-[0_0_8px_rgba(167,255,79,.35)]" : "bg-white/[0.08]"}`} />)}</div>
        <div className="space-y-2 border-t border-border/55 pt-3">{rows.map(([key, label]) => { const value = checks?.[key] ?? "pending"; return <div key={key} className="flex items-center gap-2 text-[8px] text-muted-foreground"><CircleDot className={`size-3 shrink-0 ${statusClass(value)}`} />{label}<span className={`ml-auto mono text-[7px] ${statusClass(value)}`}>{statusLabel(value)}</span></div>; })}</div>
        <div className="rounded border border-amber-300/15 bg-amber-300/[0.035] px-2.5 py-2 text-[8px] leading-relaxed text-amber-100/80">Inconclusive checks reset the streak and are never counted as clean.</div>
      </div>
    </Card>
  );
}

function RecentSessions({ sessions, loading, onSelect }: { sessions: SessionSummary[]; loading: boolean; onSelect: (session: SessionSummary) => void }) {
  return (
    <Card id="history" className="terminal-panel scroll-mt-20 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/65 px-4 py-3"><div className="flex items-center gap-2"><Clock3 className="size-3.5 text-[var(--aqua)]" /><h2 className="mono text-[10px] font-semibold">SESSION HISTORY</h2></div><span className="mono text-[8px] text-muted-foreground">PERSISTENT</span></div>
      <div className="p-2.5">{loading ? <div className="flex h-20 items-center justify-center gap-2 text-[9px] text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Loading saved sessions</div> : sessions.length === 0 ? <div className="grid min-h-[84px] place-items-center rounded border border-dashed border-border/65 text-center"><p className="mono text-[8px] text-muted-foreground">NO SAVED SESSIONS</p></div> : <ul className="space-y-1">{sessions.slice(0, 6).map((session) => <li key={session.id}><button type="button" onClick={() => onSelect(session)} className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left hover:bg-white/[0.035]"><span className={`size-1.5 rounded-full ${session.status === "completed" ? "bg-[var(--terminal-green)]" : session.status === "blocked" ? "bg-amber-300" : session.status === "running" ? "signal-live bg-[var(--terminal-green)]" : "bg-muted-foreground/45"}`} /><span className="min-w-0 flex-1 truncate text-[9px] text-foreground/85">{session.targetLabel}</span><span className="mono text-[7px] text-muted-foreground">{session.status.toUpperCase()}</span></button></li>)}</ul>}</div>
    </Card>
  );
}

function payloadMessage(event?: SessionEvent) {
  if (!event) return undefined;
  for (const key of ["message", "summary", "detail"]) if (typeof event.payload[key] === "string") return String(event.payload[key]).slice(0, 500);
  return event.type.replaceAll("_", " ").toLowerCase();
}

function matchesRole(event: SessionEvent, role: AgentRole) {
  return event.payload.actor === role || event.payload.agent === role || event.payload.role === role;
}

function roleActivity(event: SessionEvent | undefined, sessionStatus?: SessionSummary["status"]): AgentActivity {
  if (!event) return sessionStatus === "running" ? "queued" : "standby";
  const state = String(event.payload.status ?? event.payload.agentStatus ?? "").toLowerCase();
  const type = event.type.toLowerCase();
  if (state.includes("inconclusive") || type.includes("inconclusive")) return "inconclusive";
  if (state.includes("block") || state.includes("fail") || type.includes("error") || type.includes("blocked")) return "blocked";
  if (state.includes("running") || type.includes("started")) return sessionStatus === "running" ? "active" : "inconclusive";
  if (state.includes("complete") || state.includes("pass") || type.includes("completed") || type.includes("recorded")) return "complete";
  return sessionStatus === "running" ? "queued" : "standby";
}

function latestRoundChecks(events: SessionEvent[]): RoundChecksView | undefined {
  const event = events.slice().reverse().find((item) => item.type.includes("ROUND_CHECKS") || item.type.includes("ROUND_RECORDED"));
  if (!event || typeof event.payload.checks !== "object" || event.payload.checks === null) return undefined;
  const raw = event.payload.checks as Record<string, unknown>;
  const values = ["pass", "fail", "inconclusive", "not-run", "pending"] as const;
  const pick = (key: keyof RoundChecksView): CheckStatus => values.includes(raw[key] as typeof values[number]) ? raw[key] as CheckStatus : "inconclusive";
  return { noNewVerifiedFindings: pick("noNewVerifiedFindings"), regression: pick("regression"), previousExploitReplay: pick("previousExploitReplay"), independentVerification: pick("independentVerification") };
}

function sandboxSnapshot(events: SessionEvent[]): SandboxSnapshot {
  const event = events.slice().reverse().find((item) => item.type.startsWith("SANDBOX_"));
  if (!event) return { lifecycle: "not-allocated", egressVerified: null };
  const type = event.type;
  const lifecycle: SandboxSnapshot["lifecycle"] = type.includes("DESTROYED") ? "destroyed" : type.includes("CLEANUP") || type.includes("DESTROY_STARTED") ? "cleaning" : type.includes("CREATE_FAILED") || type.includes("FAILED") ? "failed" : type.includes("CREATING") ? "creating" : type.includes("CREATED") || type.includes("RUNNING") ? "running" : "not-allocated";
  const egressVerified = typeof event.payload.egressVerified === "boolean" ? event.payload.egressVerified : null;
  const resourceSummary = typeof event.payload.resourceSummary === "string" ? event.payload.resourceSummary.slice(0, 80) : undefined;
  return { lifecycle, egressVerified, ...(resourceSummary ? { evidence: resourceSummary } : {}) };
}

export function OperationsDashboard({ initialProjectId, userEmail }: { initialProjectId: string; userEmail: string }) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectName, setProjectName] = useState("");
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [target, setTarget] = useState<TargetSummary | null>(null);
  const [sourceArchive, setSourceArchive] = useState<File | null>(null);
  const [sourceAnalysisConsent, setSourceAnalysisConsent] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<SessionSummary | null>(null);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [patch, setPatch] = useState<PatchView | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [requestBusy, setRequestBusy] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "amber" | "red" | "green"; text: string } | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Session history is temporarily unavailable.");
      const body = await response.json() as { sessions?: SessionSummary[] };
      const rows = body.sessions ?? [];
      setSessions(rows);
      setActiveSession((current) => current ? rows.find((item) => item.id === current.id) ?? current : current);
    } catch (error) {
      setNotice({ tone: "amber", text: error instanceof Error ? error.message : "Session history is unavailable." });
    } finally { setHistoryLoading(false); }
  }, [projectId]);

  const loadPatch = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/report`, { cache: "no-store" });
      if (!response.ok) throw new Error("Patch history is unavailable.");
      const body = await response.json() as { patches?: Array<{ id: string; file_path: string; diff: string; rationale: string; regression_test: string; status: PatchView["status"]; sandbox_run_status: PatchView["sandboxRunStatus"] }> };
      const latest = body.patches?.at(-1);
      setPatch(latest ? { id: latest.id, filePath: latest.file_path, diff: latest.diff, rationale: latest.rationale, regressionTest: latest.regression_test, status: latest.status, sandboxRunStatus: latest.sandbox_run_status } : null);
    } catch { setPatch(null); }
  }, []);

  useEffect(() => {
    let mounted = true;
    void fetch("/api/projects", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { projects?: Array<{ id: string; name: string }> };
      if (!response.ok) throw new Error("Workspace list is unavailable until the Supabase migration is applied.");
      if (mounted) setProjects(body.projects ?? []);
    }).catch((error) => { if (mounted) setNotice({ tone: "amber", text: error instanceof Error ? error.message : "Workspace list is unavailable." }); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { setSessionEvents([]); setPatch(null); if (activeSession?.id) void loadPatch(activeSession.id); }, [activeSession?.id, loadPatch]);
  useEffect(() => { setActiveSession(null); setTarget(null); setSourceArchive(null); setSourceAnalysisConsent(false); setSessionEvents([]); }, [projectId]);

  const onEvent = useCallback((event: SessionEvent) => {
    setSessionEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event].slice(-100));
    if (event.type.startsWith("PATCH_") && activeSession?.id) void loadPatch(activeSession.id);
    if (["SESSION_COMPLETED", "SESSION_STOPPED", "SESSION_BLOCKED", "SESSION_FAILED", "STATE_CHANGED", "FINDING_RECORDED", "FINDING_VERIFIED", "ROUND_RECORDED"].includes(event.type)) void loadHistory();
  }, [activeSession?.id, loadHistory, loadPatch]);

  const activeFindings = useMemo(() => activeSession?.findings ?? [], [activeSession]);
  const checks = useMemo(() => latestRoundChecks(sessionEvents), [sessionEvents]);
  const sandbox = useMemo(() => sandboxSnapshot(sessionEvents), [sessionEvents]);
  const sessionActive = activeSession?.status === "running";

  async function startSession() {
    if (!target) return;
    if (target.kind === "archive" && !sourceArchive) {
      setNotice({ tone: "amber", text: "The source archive is not retained on the server. Re-select the ZIP/folder before starting this source-backed target." });
      document.getElementById("intake")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setRequestBusy(true);
    setNotice(null);
    try {
      const requestBody = new FormData();
      requestBody.set("projectId", projectId);
      requestBody.set("targetId", target.id);
      requestBody.set("authorizationConfirmed", "true");
      requestBody.set("sourceAnalysisConsented", sourceAnalysisConsent ? "true" : "false");
      if (sourceArchive) requestBody.set("sourceArchive", sourceArchive, sourceArchive.name);
      const response = await fetch("/api/sessions", { method: "POST", body: requestBody });
      const body = await response.json() as { session?: SessionSummary; error?: string; code?: string };
      if (!response.ok || !body.session) throw new Error(body.error || "The session could not start.");
      setActiveSession(body.session);
      setSessions((existing) => [body.session!, ...existing.filter((item) => item.id !== body.session!.id)]);
      if (body.session.status === "blocked") setNotice({ tone: "amber", text: body.session.stopReason || "The run is blocked; no clean result has been recorded." });
      else setNotice({ tone: "green", text: "Session accepted. Only persisted events and independently verified findings are shown." });
    } catch (error) {
      setNotice({ tone: "amber", text: error instanceof Error ? error.message : "The session could not start." });
      await loadHistory();
    } finally { setRequestBusy(false); }
  }

  async function stopSession() {
    if (!activeSession) return;
    setRequestBusy(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(activeSession.id)}/stop`, { method: "POST" });
      const body = await response.json() as { session?: SessionSummary; error?: string };
      if (!response.ok || !body.session) throw new Error(body.error || "Stop request was not recorded.");
      setActiveSession(body.session);
      setSessions((existing) => existing.map((item) => item.id === body.session!.id ? body.session! : item));
      setNotice({ tone: "green", text: "Emergency stop persisted. Sandbox cleanup is being confirmed." });
    } catch (error) {
      setNotice({ tone: "red", text: error instanceof Error ? error.message : "Stop request failed." });
    } finally { setRequestBusy(false); }
  }

  async function approvePatch(patchId: string) {
    if (!activeSession) return;
    if (activeSession.targetKind === "archive" && !sourceArchive) {
      setNotice({ tone: "amber", text: "Re-select the exact source ZIP/folder before the sandbox review. The server will compare its SHA-256 with this session’s source snapshot." });
      document.getElementById("intake")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setApprovalBusy(true);
    try {
      const requestBody = new FormData();
      requestBody.set("approved", "true");
      if (activeSession.targetKind === "archive" && sourceArchive) requestBody.set("sourceArchive", sourceArchive, sourceArchive.name);
      const response = await fetch(`/api/sessions/${encodeURIComponent(activeSession.id)}/patches/${encodeURIComponent(patchId)}/approve`, { method: "POST", body: requestBody });
      const body = await response.json() as { error?: string; status?: PatchView["status"]; sandboxRunStatus?: PatchView["sandboxRunStatus"] };
      if (!response.ok) throw new Error(body.error || "Patch approval could not be recorded.");
      if (body.status && body.sandboxRunStatus) setPatch((current) => current?.id === patchId ? { ...current, status: body.status!, sandboxRunStatus: body.sandboxRunStatus! } : current);
      setNotice({ tone: body.sandboxRunStatus === "pass" ? "green" : "amber", text: body.sandboxRunStatus === "pass" ? "The reviewed patch passed its bounded script in a disposable sandbox copy. Your source repository was not changed." : `Sandbox review finished: ${body.sandboxRunStatus ?? "result unavailable"}. The original source was not changed.` });
      void loadPatch(activeSession.id);
      void loadHistory();
    } catch (error) { setNotice({ tone: "amber", text: error instanceof Error ? error.message : "Patch approval could not be recorded." }); }
    finally { setApprovalBusy(false); }
  }

  async function createWorkspace() {
    const name = projectName.trim();
    if (!name || name.length > 120) return;
    setCreatingProject(true);
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const body = await response.json() as { project?: { id: string; name: string }; error?: string };
      if (!response.ok || !body.project) throw new Error(body.error || "Workspace could not be created.");
      setProjects((current) => [body.project!, ...current]); setProjectId(body.project.id); setProjectName(""); setShowCreateProject(false); setSessions([]); setActiveSession(null); setTarget(null);
    } catch (error) { setNotice({ tone: "amber", text: error instanceof Error ? error.message : "Workspace could not be created." }); }
    finally { setCreatingProject(false); }
  }

  function agent(role: AgentRole) {
    const event = sessionEvents.filter((item) => matchesRole(item, role)).at(-1);
    return <AgentPanel key={role} role={role} activity={roleActivity(event, activeSession?.status)} latestEvent={payloadMessage(event)} />;
  }

  return (
    <AppShell userEmail={userEmail}>
      <div className="mx-auto w-full max-w-[1580px] px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <div className="mb-5 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div><div className="mb-2.5 flex flex-wrap items-center gap-2"><span className="eyebrow text-[var(--terminal-green)]">GentX2 / CYBER OPERATIONS</span><span className="size-1 rounded-full bg-[var(--terminal-green)]" /><span className="mono text-[8px] text-muted-foreground">AUTHORIZED SECURITY WORKSPACE</span></div><h1 className="mono text-[22px] font-semibold leading-tight tracking-[-.04em] text-foreground sm:text-[28px]">Security command center</h1><p className="mt-2 max-w-[720px] text-[9px] leading-relaxed text-muted-foreground sm:text-[10px]">A bounded workflow for BlackHat, WhiteHat, Sentinel, Auditor, and Orchestrator. No finding, role state, or clean round is displayed without persisted evidence.</p></div>
          <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 rounded-md border border-border/70 bg-background/40 px-2.5 py-1.5"><span className="eyebrow text-muted-foreground">WORKSPACE</span><select aria-label="Active workspace" value={projectId} onChange={(event) => { setProjectId(event.target.value); setSessions([]); }} className="max-w-[180px] bg-transparent mono text-[9px] text-foreground outline-none">{projects.map((project) => <option key={project.id} value={project.id} className="bg-[#080d0b]">{project.name}</option>)}</select></label><Button variant="outline" size="sm" onClick={() => setShowCreateProject((value) => !value)}>New workspace</Button><Button size="sm" onClick={() => document.getElementById("intake")?.scrollIntoView({ behavior: "smooth" })}><Plus className="size-3.5" />New target</Button></div>
        </div>

        {showCreateProject && <form onSubmit={(event) => { event.preventDefault(); void createWorkspace(); }} className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-black/20 p-3"><label className="eyebrow text-muted-foreground" htmlFor="workspace-name">Workspace name</label><input id="workspace-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={120} required className="h-8 min-w-[180px] flex-1 rounded border border-input bg-background/60 px-2 text-sm" placeholder="Authorized team" /><Button size="sm" type="submit" disabled={creatingProject || !projectName.trim()}>{creatingProject ? <LoaderCircle className="size-3.5 animate-spin" /> : "Create workspace"}</Button></form>}

        {notice && <div role="status" className={`mb-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-[9px] leading-relaxed ${notice.tone === "red" ? "border-rose-300/20 bg-rose-400/[0.05] text-rose-100" : notice.tone === "green" ? "border-[var(--terminal-green)]/20 bg-[var(--terminal-green)]/[0.045] text-[var(--terminal-green)]" : "border-amber-300/20 bg-amber-300/[0.045] text-amber-100"}`}><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{notice.text}<button type="button" className="ml-auto text-current/70 hover:text-current" onClick={() => setNotice(null)} aria-label="Dismiss status">×</button></div>}

        <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Target scope" value={target ? target.kind.toUpperCase() : "—"} detail={target ? target.label : "No target recorded"} icon={Target} tone="green" />
          <Metric label="Trusted state" value={activeSession?.state ?? "—"} detail={activeSession ? `Round ${activeSession.round || 1}` : "Awaiting engagement"} icon={Activity} tone="cyan" />
          <Metric label="Verified findings" value={activeSession ? String(activeFindings.filter((finding) => finding.status === "verified").length) : "—"} detail={activeSession ? "Sentinel-confirmed only" : "No evidence collected"} icon={ShieldCheck} tone="amber" />
          <Metric label="Clean-round streak" value={activeSession ? `${activeSession.consecutiveCleanRounds} / 3` : "—"} detail="All four gates required" icon={CheckCircle2} tone="green" />
        </section>

        <Card className="terminal-panel mb-4 overflow-hidden border-[var(--terminal-green)]/15">
          <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-5">
            <div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldEllipsis className="size-3.5 text-[var(--terminal-green)]" /><span className="eyebrow text-[var(--terminal-green)]">TRUSTED STATE MACHINE</span></div><p className="mt-1.5 text-[8px] text-muted-foreground">Server-owned transitions · verifier-gated advancement</p></div><Badge variant={activeSession?.status === "blocked" ? "pending" : "outline"}>{activeSession ? activeSession.status.toUpperCase() : "AWAITING INTAKE"}</Badge></div>
            <StateMachine currentState={activeSession?.state ?? null} />
          </div>
        </Card>

        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.85fr)_minmax(310px,.78fr)]">
          <div className="space-y-4">
            <section aria-label="BlackHat and WhiteHat" className="grid gap-3 md:grid-cols-2">{agent("BlackHat")}{agent("WhiteHat")}</section>
            <section aria-label="Sentinel, Auditor, and Orchestrator" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{agent("Sentinel")}{agent("Auditor")}{agent("Orchestrator")}</section>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]"><VerifiedFindings findings={activeFindings} /><LiveEvents sessionId={activeSession?.id} onEvent={onEvent} /></div>
            <div className="grid gap-4 xl:grid-cols-2"><PatchDiff patch={patch} onApprove={approvePatch} approvalBusy={approvalBusy} /><TargetIntake key={projectId} projectId={projectId} onCreated={(value, archive) => { setTarget(value); setSourceArchive(archive); setSourceAnalysisConsent(false); setNotice({ tone: "green", text: "Target metadata recorded. Raw source remains transient until a session starts." }); }} /></div>
          </div>
          <aside className="space-y-4">
            <SandboxHealth snapshot={sandbox} />
            <RoundReadiness session={activeSession} checks={checks} />
            <Card className="terminal-panel overflow-hidden border-rose-300/20">
              <div className="flex items-center justify-between border-b border-border/65 px-4 py-3"><div className="flex items-center gap-2"><Shield className="size-3.5 text-rose-200" /><h2 className="mono text-[10px] font-semibold">OPERATOR CONTROL</h2></div><span className="mono text-[7px] text-muted-foreground">HUMAN AUTHORITY</span></div>
              <div className="space-y-3 p-4">
                <div className="flex items-start gap-2.5 rounded border border-border/65 bg-black/20 p-2.5"><span className={`mt-1 size-1.5 shrink-0 rounded-full ${target ? "bg-[var(--terminal-green)]" : "bg-muted-foreground/45"}`} /><div className="min-w-0"><div className="truncate text-[9px] font-medium">{target ? target.label : "No target attached"}</div><div className="mt-1 break-words text-[8px] leading-relaxed text-muted-foreground">{target ? `${target.accessMode === "source" ? "Source snapshot available" : "URL-only · guidance only"} · ${target.origin ?? "source archive"}` : "Choose an intake source and confirm written authorization."}</div></div></div>
                {activeSession?.status === "blocked" && <div className="flex gap-2 rounded border border-amber-300/20 bg-amber-300/[0.04] p-2.5 text-[8px] leading-relaxed text-amber-100"><Ban className="mt-0.5 size-3.5 shrink-0" />{activeSession.stopReason || "Run blocked. No clean round recorded."}</div>}
                {target?.accessMode === "source" && <label className="flex cursor-pointer items-start gap-2.5 rounded border border-border/65 bg-black/15 p-2.5"><input type="checkbox" checked={sourceAnalysisConsent} onChange={(event) => setSourceAnalysisConsent(event.target.checked)} disabled={sessionActive || requestBusy} className="mt-0.5 size-3.5 accent-[#5ce1d3]" /><span className="text-[8px] leading-relaxed text-muted-foreground"><span className="mb-1 block text-[9px] font-medium text-foreground/85">Allow source code analysis for this run</span>Up to three small, redacted source excerpts may be sent to the configured analysis service so WhiteHat can propose a patch. Excerpts are not stored, but automated redaction can miss secrets. Leave unchecked to keep source content inside CreateOS and disable code proposals.</span></label>}
                <div className="flex gap-2"><Button onClick={() => void startSession()} disabled={!target || requestBusy || sessionActive} className="flex-1" size="sm">{requestBusy && !sessionActive ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUpRight className="size-3.5" />}Start bounded run</Button><Button onClick={() => void stopSession()} disabled={!sessionActive || requestBusy} size="sm" variant="destructive" aria-label="Emergency stop active session"><StopCircle className="size-3.5" /><span className="hidden sm:inline">Emergency stop</span><span className="sm:hidden">Stop</span></Button></div>
                <p className="text-[8px] leading-relaxed text-muted-foreground">Stop is always visible. Every run is subject to target authorization, verified egress, and resource caps.</p>
                {activeSession && <Button asChild variant="outline" size="sm" className="w-full"><Link href={`/sessions/${encodeURIComponent(activeSession.id)}/report`}><FileText className="size-3.5" />Open final report <ArrowUpRight className="ml-auto size-3" /></Link></Button>}
              </div>
            </Card>
            <RecentSessions sessions={sessions} loading={historyLoading} onSelect={setActiveSession} />
            <div className="rounded border border-border/65 bg-black/15 px-3 py-3 text-[8px] leading-relaxed text-muted-foreground"><div className="mb-1 flex items-center gap-2 text-foreground/75"><ArrowDownRight className="size-3.5 text-[var(--aqua)]" />EVIDENCE DISCIPLINE</div>A scanner hit is not a verified finding. BlackHat, WhiteHat, Sentinel, Auditor, and Orchestrator cannot modify the verifier. Inconclusive means stop or retry, never “clean.”</div>
          </aside>
        </div>
        <footer className="mt-8 flex flex-col gap-2 border-t border-border/60 pt-4 text-[8px] text-muted-foreground/70 sm:flex-row sm:items-center sm:justify-between"><span>GentX2 · Authorized testing only · Persisted records only</span><span className="mono">NO VERIFIED RESULT IS INFERRED FROM UI STATE.</span></footer>
      </div>
    </AppShell>
  );
}
