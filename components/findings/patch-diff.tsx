import { FileCode2, GitCompareArrows } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface PatchView {
  id: string;
  filePath: string;
  diff: string;
  rationale: string;
  regressionTest: string;
  status: "proposed" | "approved" | "applied" | "rejected" | "rolled-back" | "inconclusive";
  sandboxRunStatus: "not-run" | "running" | "pass" | "fail" | "inconclusive";
}

export function PatchDiff({ patch, onApprove, approvalBusy = false }: { patch?: PatchView | null; onApprove?: (patchId: string) => void; approvalBusy?: boolean }) {
  const lines = patch?.diff.slice(0, 12_000).split("\n") ?? [];
  const canRun = patch?.status === "proposed" || (patch?.status === "approved" && ["fail", "inconclusive"].includes(patch.sandboxRunStatus));
  return (
    <Card className="terminal-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/65 px-4 py-3"><div className="flex items-center gap-2"><GitCompareArrows className="size-3.5 text-[var(--aqua)]" /><h2 className="mono text-[10px] font-semibold">PATCH DIFF</h2></div>{patch ? <Badge variant={patch.sandboxRunStatus === "pass" ? "verified" : patch.sandboxRunStatus === "fail" ? "risk" : "pending"}>{patch.sandboxRunStatus === "pass" ? "SANDBOX PASS" : patch.sandboxRunStatus === "fail" ? "SANDBOX FAIL" : patch.sandboxRunStatus === "running" ? "SANDBOX RUNNING" : patch.status.toUpperCase()}</Badge> : <Badge variant="outline">NO PATCH</Badge>}</div>
      {!patch ? <div className="grid min-h-[126px] place-items-center px-5 text-center"><div><FileCode2 className="mx-auto mb-2 size-4 text-muted-foreground/60" /><p className="text-[9px] text-muted-foreground">No persisted patch diff.</p><p className="mt-1 text-[8px] text-muted-foreground/65">A diff appears only after a source-copy patch is recorded.</p></div></div> : <div className="border-b border-border/55 px-3 py-2 mono text-[9px] text-muted-foreground">{patch.filePath}</div>}
      {patch && <pre className="max-h-[260px] overflow-auto p-3 mono text-[9px] leading-relaxed">{lines.map((line, index) => <span key={`${index}-${line.slice(0, 18)}`} className={`block whitespace-pre-wrap break-all ${line.startsWith("+") && !line.startsWith("+++") ? "bg-emerald-400/[0.07] text-emerald-200" : line.startsWith("-") && !line.startsWith("---") ? "bg-rose-400/[0.06] text-rose-200" : line.startsWith("@@") ? "text-[var(--aqua)]" : "text-muted-foreground"}`}>{line || " "}</span>)}</pre>}
      {patch && <div className="border-t border-border/55 p-3"><div className="mb-1 text-[8px] font-medium text-foreground/80">WHITEHAT RATIONALE</div><p className="mb-3 text-[8px] leading-relaxed text-muted-foreground">{patch.rationale}</p><div className="mb-2 text-[8px] font-medium text-foreground/80">PROPOSED REGRESSION CHECK · REVIEW BEFORE RUNNING</div><pre className="max-h-[180px] overflow-auto rounded border border-border/50 bg-black/25 p-2.5 mono text-[8px] leading-relaxed text-muted-foreground">{patch.regressionTest || "No regression script was supplied."}</pre><p className="mt-2 text-[8px] leading-relaxed text-muted-foreground">This patch is an unverified proposal. Approval applies it and runs the displayed script in a disposable, unprivileged CreateOS copy with no application credentials. The check records only the script result; it does not verify the finding or change your repository.</p></div>}
      {canRun && onApprove && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/55 p-3"><p className="text-[8px] text-muted-foreground">Read both the diff and script before approving the sandbox run.</p><Button size="sm" disabled={approvalBusy} onClick={() => onApprove(patch.id)}>{approvalBusy ? "Running sandbox check…" : patch.status === "proposed" ? "Approve and test in sandbox" : "Retry sandbox check"}</Button></div>}
    </Card>
  );
}
