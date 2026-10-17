import { Bot, Bug, CheckCheck, ClipboardCheck, Code2, ScanSearch, ShieldCheck, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export type AgentRole = "BlackHat" | "WhiteHat" | "Sentinel" | "Auditor" | "Orchestrator";
export type AgentActivity = "active" | "complete" | "blocked" | "inconclusive" | "queued" | "standby";

const agentInfo: Record<AgentRole, { icon: typeof Bug; subtitle: string; mandate: string; accent: string; dot: string; glow: string; edge: string }> = {
  BlackHat: { icon: Bug, subtitle: "Authorized test analyst", mandate: "Scope-bound discovery · non-destructive proofs", accent: "text-rose-200", dot: "bg-rose-200", glow: "bg-rose-300/[0.07]", edge: "border-rose-300/25 agent-glow-red" },
  WhiteHat: { icon: Code2, subtitle: "Source-copy remediation", mandate: "Evidence-backed proposal · human-reviewed sandbox check", accent: "text-[var(--terminal-green)]", dot: "bg-[var(--terminal-green)]", glow: "bg-[var(--terminal-green)]/[0.06]", edge: "border-[var(--terminal-green)]/25 agent-glow-green" },
  Sentinel: { icon: ShieldCheck, subtitle: "Independent verifier", mandate: "Separate sandbox · deterministic replay", accent: "text-[var(--aqua)]", dot: "bg-[var(--aqua)]", glow: "bg-[var(--aqua)]/[0.06]", edge: "border-[var(--aqua)]/25 agent-glow-cyan" },
  Auditor: { icon: ClipboardCheck, subtitle: "Evidence and diff review", mandate: "Build · lint · regression · audit trail", accent: "text-amber-200", dot: "bg-amber-200", glow: "bg-amber-300/[0.06]", edge: "border-amber-300/20" },
  Orchestrator: { icon: Workflow, subtitle: "Trusted policy coordinator", mandate: "Budgets · state gates · stop conditions", accent: "text-sky-200", dot: "bg-sky-200", glow: "bg-sky-300/[0.06]", edge: "border-sky-300/20" },
};

const activityLabel: Record<AgentActivity, string> = { active: "RUNNING", complete: "RECORDED", blocked: "BLOCKED", inconclusive: "INCONCLUSIVE", queued: "QUEUED", standby: "STANDBY" };

export function AgentPanel({ role, activity = "standby", latestEvent }: { role: AgentRole; activity?: AgentActivity; latestEvent?: string }) {
  const details = agentInfo[role];
  const Icon = details.icon;
  const live = activity === "active";
  const completed = activity === "complete";
  const blocked = activity === "blocked" || activity === "inconclusive";
  const tone = live ? "text-[var(--terminal-green)]" : completed ? "text-[var(--aqua)]" : blocked ? "text-rose-200" : "text-muted-foreground";
  return (
    <Card className={`terminal-panel min-w-0 overflow-hidden border ${details.edge}`}>
      <div className="flex items-start justify-between gap-3 border-b border-border/65 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`grid size-9 shrink-0 place-items-center rounded-md border border-current/15 ${details.glow} ${details.accent}`}><Icon className="size-4" strokeWidth={1.7} /></div>
          <div className="min-w-0"><div className="flex items-center gap-2"><h2 className="mono text-[12px] font-semibold tracking-wide">{role}</h2>{role === "Sentinel" && <CheckCheck className="size-3 text-[var(--aqua)]" />}</div><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{details.subtitle}</p></div>
        </div>
        <Badge variant="outline" className="shrink-0"><span className={`mr-1.5 size-1.5 rounded-full ${live ? `signal-live ${details.dot}` : completed ? "bg-[var(--aqua)]" : blocked ? "bg-rose-300" : activity === "queued" ? "bg-amber-300" : "bg-muted-foreground/45"}`} />{activityLabel[activity]}</Badge>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground"><ScanSearch className="size-3.5 shrink-0" /><span className="truncate">{details.mandate}</span></div>
        <div className="flex min-h-[54px] items-start gap-2.5 rounded-md border border-border/60 bg-black/20 px-3 py-2.5"><Bot className={`mt-0.5 size-3.5 shrink-0 ${tone}`} /><p className="line-clamp-3 break-words text-[9px] leading-relaxed text-foreground/75">{latestEvent || (activity === "queued" ? `Waiting for the trusted state machine to schedule ${role}.` : `No persisted ${role} event yet. This panel remains idle until real activity is recorded.`)}</p></div>
        <div className="flex items-center justify-between border-t border-border/55 pt-2 text-[8px] text-muted-foreground/75"><span>TRUSTED ROLE</span><span className={`mono ${details.accent}`}>{live ? "EVENT STREAM ACTIVE" : activityLabel[activity]}</span></div>
      </div>
    </Card>
  );
}
