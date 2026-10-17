import { ArrowRight, Check, Circle, Dot } from "lucide-react";
import { cn } from "@/lib/utils";

export const STATE_ORDER = ["INTAKE", "BASELINE", "ATTACK", "VERIFY", "PATCH", "REGRESSION", "RETEST", "RECORD", "CONTINUE_OR_STOP"] as const;
export type WorkflowState = (typeof STATE_ORDER)[number];

export function StateMachine({ currentState }: { currentState?: WorkflowState | null }) {
  const currentIndex = currentState ? STATE_ORDER.indexOf(currentState) : -1;
  return (
    <div className="overflow-x-auto">
      <ol className="flex min-w-[830px] items-center gap-1.5" aria-label="Trusted engagement state machine">
        {STATE_ORDER.map((state, index) => {
          const complete = currentIndex >= 0 && index < currentIndex;
          const active = currentIndex === index;
          return <li key={state} className="flex flex-1 items-center gap-1.5"><div className="flex min-w-0 items-center gap-1.5"><span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", complete ? "border-[var(--terminal-green)]/50 bg-[var(--terminal-green)]/10 text-[var(--terminal-green)]" : active ? "border-[var(--terminal-green)]/65 bg-[var(--terminal-green)]/15 text-[var(--terminal-green)] shadow-[0_0_10px_rgba(167,255,79,.12)]" : "border-border bg-white/[0.02] text-muted-foreground/55")}>{complete ? <Check className="size-3" /> : active ? <Dot className="size-4" /> : <Circle className="size-2 fill-current" />}</span><span className={cn("truncate mono text-[8px] tracking-tight", active ? "text-[var(--terminal-green)]" : complete ? "text-foreground/75" : "text-muted-foreground/60")}>{state}</span></div>{index < STATE_ORDER.length - 1 && <ArrowRight className={cn("size-3 shrink-0", complete ? "text-[var(--terminal-green)]/65" : "text-border")} />}</li>;
        })}
      </ol>
      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 mono text-[7px] text-muted-foreground"><span>{currentState ? `CURRENT TRUSTED STATE: ${currentState}` : "NO ENGAGEMENT STATE RECORDED"}</span><span className="text-amber-200">INCONCLUSIVE ≠ CLEAN</span></div>
    </div>
  );
}
