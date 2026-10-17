import { RoundChecksSchema, WorkflowStateSchema, type RoundChecks, type WorkflowState } from "@/lib/schemas/contracts";

const transitions: Record<WorkflowState, readonly WorkflowState[]> = {
  INTAKE: ["BASELINE"],
  BASELINE: ["ATTACK"],
  ATTACK: ["VERIFY"],
  VERIFY: ["PATCH", "REGRESSION", "RECORD"],
  PATCH: ["REGRESSION"],
  REGRESSION: ["RETEST"],
  RETEST: ["RECORD"],
  RECORD: ["CONTINUE_OR_STOP"],
  CONTINUE_OR_STOP: ["BASELINE"],
};

export function canTransition(from: WorkflowState, to: WorkflowState) {
  return transitions[from].includes(to);
}

export function assertTransition(from: WorkflowState, to: WorkflowState) {
  if (!canTransition(from, to)) throw new Error(`Invalid workflow transition: ${from} -> ${to}`);
}

export function isCleanRound(input: RoundChecks) {
  const checks = RoundChecksSchema.parse(input);
  return !checks.inconclusive
    && checks.noNewVerifiedFindings === "pass"
    && checks.regression === "pass"
    && checks.previousExploitReplay === "pass"
    && checks.independentVerification === "pass";
}

export function nextCleanStreak(previous: number, checks: RoundChecks) {
  if (!Number.isInteger(previous) || previous < 0 || previous > 3) throw new Error("Clean-round streak must be an integer between 0 and 3");
  if (!isCleanRound(checks)) return 0;
  return Math.min(3, previous + 1);
}

export function shouldStopAfterRound(streak: number, hardRoundLimit = 10) {
  if (!Number.isInteger(streak) || streak < 0 || streak > 3) throw new Error("Invalid clean-round streak");
  if (!Number.isInteger(hardRoundLimit) || hardRoundLimit < 1 || hardRoundLimit > 10) throw new Error("Invalid hard round limit");
  return streak >= 3;
}

export function nextRound(currentRound: number, hardRoundLimit = 10) {
  if (!Number.isInteger(currentRound) || currentRound < 0) throw new Error("Invalid round number");
  if (currentRound >= hardRoundLimit) return null;
  return currentRound + 1;
}
