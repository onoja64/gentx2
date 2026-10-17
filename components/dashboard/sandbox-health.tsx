import { Activity, Cable, Cpu, HardDrive, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface SandboxSnapshot {
  lifecycle: "not-allocated" | "creating" | "running" | "cleaning" | "destroyed" | "failed";
  egressVerified: boolean | null;
  evidence?: string;
}

const labels: Record<SandboxSnapshot["lifecycle"], string> = {
  "not-allocated": "NOT ALLOCATED",
  creating: "CREATING",
  running: "RUNNING",
  cleaning: "CLEANUP",
  destroyed: "DESTROYED",
  failed: "FAILED",
};

export function SandboxHealth({ snapshot }: { snapshot: SandboxSnapshot }) {
  const live = snapshot.lifecycle === "running";
  return (
    <Card className="terminal-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/65 px-4 py-3"><div className="flex items-center gap-2"><Activity className="size-3.5 text-[var(--aqua)]" /><h2 className="mono text-[10px] font-semibold">SANDBOX HEALTH</h2></div><Badge variant={snapshot.lifecycle === "failed" ? "risk" : live ? "verified" : "outline"}><span className={`mr-1.5 size-1.5 rounded-full ${live ? "signal-live bg-[var(--terminal-green)]" : snapshot.lifecycle === "failed" ? "bg-rose-300" : "bg-muted-foreground/45"}`} />{labels[snapshot.lifecycle]}</Badge></div>
      <div className="grid grid-cols-2 gap-2 p-3">
        <div className="rounded-md border border-border/60 bg-black/20 p-2.5"><div className="flex items-center gap-2 text-[8px] text-muted-foreground"><Cable className="size-3" />SCOPED EGRESS</div><div className={`mt-2 mono text-[10px] ${snapshot.egressVerified ? "text-[var(--terminal-green)]" : "text-muted-foreground"}`}>{snapshot.egressVerified === true ? "POLICY VERIFIED" : snapshot.egressVerified === false ? "POLICY FAILED" : "NOT VERIFIED"}</div></div>
        <div className="rounded-md border border-border/60 bg-black/20 p-2.5"><div className="flex items-center gap-2 text-[8px] text-muted-foreground"><Cpu className="size-3" />RESOURCE TELEMETRY</div><div className="mt-2 mono text-[10px] text-muted-foreground">{snapshot.evidence || "NO METRICS RECORDED"}</div></div>
        <div className="col-span-2 flex items-center gap-2 px-1 pt-1 text-[8px] text-muted-foreground/75"><ShieldCheck className="size-3 text-[var(--aqua)]" /><HardDrive className="size-3" />Ephemeral CreateOS guest · no target credentials injected</div>
      </div>
    </Card>
  );
}
