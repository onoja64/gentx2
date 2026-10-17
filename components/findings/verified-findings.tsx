import { CheckCheck, FileSearch, Fingerprint } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export interface FindingView {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  status: "verified" | "unverified" | "inconclusive" | "resolved";
  evidenceHash?: string;
}

export function VerifiedFindings({ findings = [] }: { findings?: FindingView[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3.5">
        <div className="flex items-center gap-2"><Fingerprint className="size-3.5 text-primary" /><h2 className="text-[11px] font-semibold">Finding candidates</h2></div>
        <Badge variant="outline">{findings.length} RECORDED</Badge>
      </div>
      <div className="p-3">
        {findings.length === 0 ? (
          <div className="grid min-h-[128px] place-items-center rounded-lg border border-dashed border-border/75 bg-background/25 px-5 text-center">
            <div><FileSearch className="mx-auto mb-2 size-4 text-muted-foreground/60" /><p className="text-[10px] text-muted-foreground">No finding candidates recorded.</p><p className="mt-1 text-[9px] text-muted-foreground/65">Scanner output requires independent verification before it is marked verified.</p></div>
          </div>
        ) : (
          <ul className="space-y-2">
            {findings.map((finding) => <li key={finding.id} className="rounded-lg border border-border/75 bg-background/30 p-3"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2"><CheckCheck className="mt-0.5 size-3.5 shrink-0 text-primary" /><div><div className="text-[11px] font-medium">{finding.title}</div>{finding.evidenceHash && <div className="mt-1 mono text-[9px] text-muted-foreground">sha256:{finding.evidenceHash.slice(0, 12)}</div>}</div></div><div className="flex shrink-0 flex-col items-end gap-1"><Badge variant={finding.status === "verified" ? "verified" : finding.status === "inconclusive" ? "pending" : "outline"}>{finding.severity.toUpperCase()}</Badge><span className="mono text-[8px] text-muted-foreground">{finding.status.toUpperCase()}</span></div></div></li>)}
          </ul>
        )}
      </div>
    </Card>
  );
}
