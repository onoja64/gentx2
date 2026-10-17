import { z } from "zod";

const SafeSummary = z.string().min(1).max(2000);
export const BlackHatOutputSchema = z.object({
  observations: z.array(z.object({ title: z.string().min(1).max(180), severity: z.enum(["critical","high","medium","low","info"]), confidence: z.enum(["confirmed","high","medium","low","unknown"]), summary: SafeSummary, path: z.string().max(2048).optional(), evidenceIds: z.array(z.string().uuid()).max(20) }).strict()).max(20),
  safeChecks: z.array(z.object({ name: z.string().min(1).max(120), rationale: z.string().max(500), destructive: z.literal(false) }).strict()).max(10),
  inconclusive: z.boolean(),
}).strict();
export const WhiteHatOutputSchema = z.object({
  proposals: z.array(z.object({ filePath: z.string().min(1).max(2048), unifiedDiff: z.string().min(1).max(12000), rationale: z.string().max(1200), regressionTest: z.string().max(5000), findingId: z.string().uuid() }).strict()).max(5),
  requiresHumanApproval: z.literal(true),
}).strict();
export const SentinelOutputSchema = z.object({
  verdict: z.enum(["verified","rejected","inconclusive"]),
  findingIds: z.array(z.string().uuid()).max(20),
  evidenceIds: z.array(z.string().uuid()).max(50),
  rationale: SafeSummary,
  verifierVersion: z.string().min(1).max(80),
}).strict();
export const AuditorOutputSchema = z.object({
  verdict: z.enum(["pass","fail","inconclusive"]),
  checks: z.array(z.object({ name: z.string().min(1).max(120), status: z.enum(["pass","fail","inconclusive","not-run"]), evidenceId: z.string().uuid().optional(), detail: z.string().max(500) }).strict()).max(20),
  policyViolations: z.array(z.string().max(300)).max(10),
  summary: SafeSummary,
}).strict();
export const OrchestratorOutputSchema = z.object({
  recommendation: z.enum(["continue","stop","human-review","inconclusive"]),
  rationale: SafeSummary,
  requestedNextAction: z.string().max(160),
}).strict();
