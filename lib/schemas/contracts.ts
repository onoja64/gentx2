import { z } from "zod";

export const TargetKindSchema = z.enum(["archive", "github", "url"]);
export type TargetKind = z.infer<typeof TargetKindSchema>;
export const WorkflowStateSchema = z.enum(["INTAKE", "BASELINE", "ATTACK", "VERIFY", "PATCH", "REGRESSION", "RETEST", "RECORD", "CONTINUE_OR_STOP"]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export const SessionStatusSchema = z.enum(["ready", "running", "blocked", "stopped", "completed", "failed"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export const CheckStatusSchema = z.enum(["pass", "fail", "inconclusive", "not-run", "pending"]);

export const TargetRecordSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  ownerId: z.string().uuid(),
  kind: TargetKindSchema,
  label: z.string().min(1).max(160),
  origin: z.string().url().max(2048).optional(),
  scopePaths: z.array(z.string().min(1).max(512)).min(1).max(50),
  accessMode: z.enum(["source", "url-only"]),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceReference: z.string().url().max(2048).optional(),
  authorizationConfirmed: z.literal(true),
  authorizationPhrase: z.literal("I AM AUTHORIZED"),
  authorizedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
}).strict();
export type TargetRecord = z.infer<typeof TargetRecordSchema>;

export const EvidenceSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["scanner", "poc", "regression", "replay", "verifier", "build", "lint", "diff"]),
  verified: z.boolean(),
  commandHash: z.string().regex(/^[a-f0-9]{64}$/),
  stdoutHash: z.string().regex(/^[a-f0-9]{64}$/),
  stderrHash: z.string().regex(/^[a-f0-9]{64}$/),
  exitCode: z.number().int().min(-255).max(255).nullable(),
  elapsedMs: z.number().int().nonnegative().max(60 * 60 * 1000),
  boundedOutput: z.string().max(16_384),
  recordedAt: z.string().datetime(),
}).strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(240),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  confidence: z.enum(["confirmed", "high", "medium", "low", "unknown"]),
  status: z.enum(["verified", "unverified", "inconclusive", "resolved"]),
  summary: z.string().min(1).max(4000),
  targetPath: z.string().max(2048).optional(),
  evidenceIds: z.array(z.string().uuid()).max(100),
  round: z.number().int().positive().max(10),
  verifierVersion: z.string().min(1).max(100).optional(),
  createdAt: z.string().datetime(),
}).strict();
export type Finding = z.infer<typeof FindingSchema>;

export const RoundChecksSchema = z.object({
  noNewVerifiedFindings: CheckStatusSchema,
  regression: CheckStatusSchema,
  previousExploitReplay: CheckStatusSchema,
  independentVerification: CheckStatusSchema,
  inconclusive: z.boolean(),
}).strict();
export type RoundChecks = z.infer<typeof RoundChecksSchema>;

export const AuditEventSchema = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  sequence: z.number().int().positive(),
  actor: z.enum(["user", "blackhat", "whitehat", "sentinel", "auditor", "orchestrator", "system"]),
  type: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  previousHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  eventHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const IntakeRequestSchema = z.object({
  kind: TargetKindSchema,
  projectId: z.string().uuid(),
  authorizationConfirmed: z.literal("true"),
  authorizationPhrase: z.literal("I AM AUTHORIZED"),
  scopePaths: z.string().min(2).max(25_600),
  url: z.string().max(2048).optional(),
  repoUrl: z.string().max(2048).optional(),
}).strict();

export const SessionCreateSchema = z.object({
  projectId: z.string().uuid(),
  targetId: z.string().uuid(),
  authorizationConfirmed: z.literal(true),
}).strict();
