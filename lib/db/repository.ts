import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appendAuditEvent } from "@/lib/events/audit";
import { assertTransition } from "@/lib/state-machine/engine";
import { FindingSchema, RoundChecksSchema, type Finding, type TargetKind, type WorkflowState } from "@/lib/schemas/contracts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Db = SupabaseClient;
export interface CreateTargetInput {
  projectId: string; ownerId: string; kind: TargetKind; label: string; origin?: string; scopePaths: string[];
  accessMode: "source" | "url-only"; sourceHash?: string; sourceReference?: string;
  authorizationConfirmed: true; authorizationPhrase: "I AM AUTHORIZED";
}

function fail(error: { message?: string } | null, label: string): never {
  throw new Error(`${label}${error?.message ? `: ${error.message.slice(0, 180)}` : ""}`);
}
function unwrap<T>(data: T | null, error: { message?: string } | null, label: string): T {
  if (error || data === null) return fail(error, label);
  return data;
}

export async function listProjects(client: Db) {
  const { data, error } = await client.from("projects").select("id,name,owner_id,created_at").order("created_at", { ascending: false }).limit(50);
  if (error) fail(error, "Project history unavailable");
  return (data ?? []).map((row: any) => ({ id: row.id as string, name: row.name as string, ownerId: row.owner_id as string, createdAt: row.created_at as string }));
}

export async function createProject(client: Db, ownerId: string, name: string) {
  const { data, error } = await client.from("projects").insert({ owner_id: ownerId, name: name.slice(0, 120) }).select("id,name,owner_id,created_at").single();
  const row = unwrap(data, error, "Project could not be created");
  return { id: row.id as string, name: row.name as string, ownerId: row.owner_id as string, createdAt: row.created_at as string };
}

export async function createTarget(client: Db, input: CreateTargetInput) {
  createSupabaseAdminClient(); // fail before the user-scoped insert if immutable audit is not configured
  const now = new Date().toISOString();
  const { data, error } = await client.from("targets").insert({
    project_id: input.projectId, owner_id: input.ownerId, kind: input.kind, label: input.label, origin: input.origin ?? null,
    scope_paths: input.scopePaths, access_mode: input.accessMode, source_hash: input.sourceHash ?? null,
    source_reference: input.sourceReference ?? null, authorization_confirmed: true, authorization_phrase: input.authorizationPhrase, authorized_at: now,
  }).select("id,kind,label,origin,scope_paths,access_mode,source_hash,source_reference,authorization_confirmed,authorization_phrase,authorized_at,created_at,project_id,owner_id").single();
  const row = unwrap(data, error, "Target could not be recorded");
  await appendAuditEvent({ projectId: input.projectId, targetId: row.id, actor: "user", type: "TARGET_AUTHORIZED", payload: { kind: input.kind, label: input.label, origin: input.origin ?? null, scopePaths: input.scopePaths, accessMode: input.accessMode, sourceHash: input.sourceHash ?? null, authorizedAt: now } });
  return mapTarget(row);
}

function mapTarget(row: any) {
  return {
    id: String(row.id), kind: row.kind as TargetKind, label: String(row.label), ...(row.origin ? { origin: String(row.origin) } : {}),
    scopePaths: (Array.isArray(row.scope_paths) ? row.scope_paths : []) as string[], accessMode: row.access_mode as "source" | "url-only",
    ...(row.source_hash ? { sourceHash: String(row.source_hash) } : {}), ...(row.source_reference ? { sourceReference: String(row.source_reference) } : {}),
    authorizationConfirmed: row.authorization_confirmed === true, authorizationPhrase: row.authorization_phrase as string,
    projectId: String(row.project_id), ownerId: String(row.owner_id), authorizedAt: String(row.authorized_at), createdAt: String(row.created_at),
  };
}

export async function getTarget(client: Db, targetId: string) {
  const { data, error } = await client.from("targets").select("*").eq("id", targetId).maybeSingle();
  if (error) fail(error, "Target lookup unavailable");
  return data ? mapTarget(data) : null;
}

export async function recordSourceHash(admin: Db, targetId: string, sourceHash: string) {
  const { data, error } = await admin.from("targets").update({ source_hash: sourceHash }).eq("id", targetId).select("project_id").single();
  const row = unwrap(data, error, "Source snapshot hash could not be recorded");
  await appendAuditEvent({ projectId: row.project_id, targetId, actor: "orchestrator", type: "SOURCE_SNAPSHOT_HASHED", payload: { sourceHash } });
}

export async function createSession(client: Db, target: Awaited<ReturnType<typeof getTarget>>, ownerId: string, options: { sourceHash: string | null; sourceAnalysisConsented: boolean }) {
  createSupabaseAdminClient(); // fail before the user-scoped insert if immutable audit is not configured
  if (!target || !target.authorizationConfirmed || target.authorizationPhrase !== "I AM AUTHORIZED") throw new Error("Target authorization record is missing or invalid");
  if (options.sourceAnalysisConsented && (target.accessMode !== "source" || !options.sourceHash)) throw new Error("Source analysis consent requires a source snapshot");
  const { data, error } = await client.from("scans").insert({ project_id: target.projectId, target_id: target.id, owner_id: ownerId, status: "running", workflow_state: "INTAKE", round: 0, consecutive_clean_rounds: 0, hard_round_limit: 10, source_hash: options.sourceHash, source_analysis_consented: options.sourceAnalysisConsented }).select("*").single();
  const row = unwrap(data, error, "Scan could not be created");
  await appendAuditEvent({ projectId: target.projectId, scanId: row.id, targetId: target.id, actor: "orchestrator", type: "SESSION_CREATED", payload: { state: "INTAKE", round: 0, hardRoundLimit: 10, authorizationRecordChecked: true, sourceAnalysisConsented: options.sourceAnalysisConsented, sourceHash: options.sourceHash } });
  return mapSession(row, target, []);
}

function mapSession(row: any, target?: any, findings: any[] = []) {
  return {
    id: String(row.id), targetId: String(row.target_id), projectId: String(row.project_id), ownerId: String(row.owner_id),
    targetLabel: target?.label ?? String(row.target_label ?? "Authorized target"), targetKind: target?.kind ?? row.target_kind,
    targetOrigin: target?.origin ?? null, targetAccessMode: target?.accessMode ?? target?.access_mode,
    targetSourceHash: target?.sourceHash ?? target?.source_hash ?? null, targetSourceReference: target?.sourceReference ?? target?.source_reference ?? null,
    scopePaths: target?.scopePaths ?? target?.scope_paths ?? [], status: row.status as "ready" | "running" | "blocked" | "stopped" | "completed" | "failed",
    state: row.workflow_state as WorkflowState | null, round: Number(row.round), consecutiveCleanRounds: Number(row.consecutive_clean_rounds),
    hardRoundLimit: Number(row.hard_round_limit), sandboxId: row.sandbox_id ?? null, stopReason: row.stop_reason ?? null,
    sourceHash: row.source_hash ?? null, sourceAnalysisConsented: row.source_analysis_consented === true,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    findings: findings.map((f: any) => ({ id: f.id, title: f.title, severity: f.severity, confidence: f.confidence, status: f.status, summary: f.summary, targetPath: f.target_path ?? undefined, evidenceIds: f.evidence_ids ?? [], round: f.round, createdAt: f.created_at })),
  };
}

export async function getSession(client: Db, scanId: string) {
  const { data, error } = await client.from("scans").select("*, targets(*)").eq("id", scanId).maybeSingle();
  if (error) fail(error, "Scan lookup unavailable");
  if (!data) return null;
  const target = data.targets ? mapTarget(data.targets) : undefined;
  const { data: findings, error: findingError } = await client.from("findings").select("*").eq("scan_id", scanId).order("created_at", { ascending: true }).limit(100);
  if (findingError) fail(findingError, "Finding history unavailable");
  return mapSession(data, target, findings ?? []);
}

export async function getSessionForExecution(admin: Db, scanId: string) {
  const { data, error } = await admin.from("scans").select("*, targets(*)").eq("id", scanId).maybeSingle();
  if (error) fail(error, "Trusted scan lookup unavailable");
  if (!data || !data.targets) return null;
  const target = mapTarget(data.targets);
  const { data: findings, error: findingError } = await admin.from("findings").select("*").eq("scan_id", scanId).order("created_at").limit(100);
  if (findingError) fail(findingError, "Trusted finding lookup unavailable");
  return { ...mapSession(data, target, findings ?? []), target };
}

export async function listSessions(client: Db, projectId: string, limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const { data, error } = await client.from("scans").select("*, targets(*)").eq("project_id", projectId).order("created_at", { ascending: false }).limit(safeLimit);
  if (error) fail(error, "Session history unavailable");
  const rows = data ?? [];
  return Promise.all(rows.map(async (row: any) => {
    const { data: findings, error: findingError } = await client.from("findings").select("*").eq("scan_id", row.id).order("created_at").limit(100);
    if (findingError) fail(findingError, "Finding history unavailable");
    return mapSession(row, row.targets ? mapTarget(row.targets) : undefined, findings ?? []);
  }));
}

export async function setSessionSandboxId(admin: Db, scanId: string, sandboxId: string | null) {
  const { data, error } = await admin.from("scans").update({ sandbox_id: sandboxId, updated_at: new Date().toISOString() }).eq("id", scanId).select("project_id,target_id").single();
  const row = unwrap(data, error, "Sandbox lifecycle could not be recorded");
  await appendAuditEvent({ projectId: row.project_id, scanId, targetId: row.target_id, actor: "orchestrator", type: sandboxId ? "SANDBOX_ATTACHED" : "SANDBOX_DETACHED", payload: { sandboxId } });
}

export async function claimSessionSandboxSlot(admin: Db, scanId: string, token: string) {
  const { data, error } = await admin.from("scans").update({ sandbox_id: token, updated_at: new Date().toISOString() }).eq("id", scanId).in("status", ["blocked", "stopped", "completed", "failed"]).is("sandbox_id", null).select("project_id,target_id").maybeSingle();
  if (error) fail(error, "Session sandbox slot could not be claimed");
  if (!data) return false;
  await appendAuditEvent({ projectId: data.project_id, scanId, targetId: data.target_id, actor: "orchestrator", type: "PATCH_SANDBOX_SLOT_CLAIMED", payload: { claimToken: token } });
  return true;
}

export async function attachClaimedSessionSandbox(admin: Db, scanId: string, token: string, sandboxId: string) {
  const { data, error } = await admin.from("scans").update({ sandbox_id: sandboxId, updated_at: new Date().toISOString() }).eq("id", scanId).eq("sandbox_id", token).select("project_id,target_id").maybeSingle();
  if (error) fail(error, "Patch sandbox could not be attached to its session");
  if (!data) throw new Error("Session sandbox slot ownership changed");
  await appendAuditEvent({ projectId: data.project_id, scanId, targetId: data.target_id, actor: "orchestrator", type: "SANDBOX_ATTACHED", payload: { sandboxId, purpose: "patch-review" } });
}

export async function releaseClaimedSessionSandbox(admin: Db, scanId: string, token: string, sandboxId?: string) {
  const allowedIds = sandboxId ? [token, sandboxId] : [token];
  const { data, error } = await admin.from("scans").update({ sandbox_id: null, updated_at: new Date().toISOString() }).eq("id", scanId).in("sandbox_id", allowedIds).select("project_id,target_id").maybeSingle();
  if (error) fail(error, "Patch sandbox slot could not be released");
  if (data) await appendAuditEvent({ projectId: data.project_id, scanId, targetId: data.target_id, actor: "orchestrator", type: "SANDBOX_DETACHED", payload: { purpose: "patch-review" } });
}

export async function transitionSession(admin: Db, scanId: string, to: WorkflowState, options: { status?: "running" | "blocked" | "stopped" | "completed" | "failed"; stopReason?: string | null; payload?: Record<string, unknown> } = {}) {
  const { data: current, error: readError } = await admin.from("scans").select("workflow_state,status,project_id,target_id").eq("id", scanId).single();
  const row = unwrap(current, readError, "Scan state unavailable");
  if (["blocked", "stopped", "completed", "failed"].includes(row.status)) throw new Error("Terminal scan state cannot transition");
  if (row.workflow_state && row.workflow_state !== to) assertTransition(row.workflow_state as WorkflowState, to);
  const { data: changed, error } = await admin.from("scans").update({ workflow_state: to, status: options.status ?? row.status, stop_reason: options.stopReason ?? null, updated_at: new Date().toISOString() }).eq("id", scanId).eq("workflow_state", row.workflow_state).not("status", "in", "(stopped,completed,failed)").select("id").maybeSingle();
  if (error) fail(error, "Trusted workflow transition failed");
  if (!changed) throw new Error("Scan state changed concurrently; transition was rejected");
  await appendAuditEvent({ projectId: row.project_id, scanId, targetId: row.target_id, actor: "orchestrator", type: "STATE_CHANGED", payload: { from: row.workflow_state, to, ...options.payload } });
}

export async function setSessionStatus(admin: Db, scanId: string, status: "ready" | "running" | "blocked" | "stopped" | "completed" | "failed", reason: string | null, eventType: string, payload: Record<string, unknown> = {}) {
  let update = admin.from("scans").update({ status, stop_reason: reason, updated_at: new Date().toISOString() }).eq("id", scanId);
  update = status === "stopped"
    ? update.eq("status", "running")
    : update.not("status", "in", "(blocked,stopped,completed,failed)");
  const { data, error } = await update.select("project_id,target_id").maybeSingle();
  if (error) fail(error, "Trusted scan status update failed");
  if (!data) return false;
  const row = data;
  await appendAuditEvent({ projectId: row.project_id, scanId, targetId: row.target_id, actor: "orchestrator", type: eventType, payload: { status, reason, ...payload } });
  return true;
}

export async function recordAgentRun(admin: Db, input: { projectId: string; scanId: string; agentRole: string; status: string; model?: string; inputHash?: string; outputHash?: string; inputTokens?: number; outputTokens?: number; errorCode?: string; result?: unknown }) {
  const { data, error } = await admin.from("agent_runs").insert({ project_id: input.projectId, scan_id: input.scanId, agent_role: input.agentRole, status: input.status, model: input.model ?? null, input_hash: input.inputHash ?? null, output_hash: input.outputHash ?? null, input_tokens: input.inputTokens ?? null, output_tokens: input.outputTokens ?? null, error_code: input.errorCode ?? null, result: input.result ?? null, completed_at: input.status === "running" || input.status === "queued" ? null : new Date().toISOString() }).select("id").single();
  if (error) fail(error, "Agent run could not be recorded");
  return data.id as string;
}

export async function recordSessionFinding(admin: Db, scanId: string, input: Finding, actor: "blackhat" | "sentinel" = "sentinel") {
  const finding = FindingSchema.parse(input);
  const { data: scan, error: readError } = await admin.from("scans").select("project_id,target_id").eq("id", scanId).single();
  const parent = unwrap(scan, readError, "Scan not found for finding");
  const { error } = await admin.from("findings").insert({ id: finding.id, project_id: parent.project_id, scan_id: scanId, title: finding.title, severity: finding.severity, confidence: finding.confidence, status: finding.status, summary: finding.summary, target_path: finding.targetPath ?? null, evidence_ids: finding.evidenceIds, round: finding.round, verifier_version: finding.verifierVersion ?? null, created_at: finding.createdAt });
  if (error) fail(error, "Finding could not be recorded");
  await appendAuditEvent({ projectId: parent.project_id, scanId, targetId: parent.target_id, actor, type: finding.status === "verified" ? "FINDING_VERIFIED" : "FINDING_RECORDED", payload: { findingId: finding.id, title: finding.title, severity: finding.severity, status: finding.status, evidenceIds: finding.evidenceIds } });
}

export async function recordPatchProposal(admin: Db, input: { projectId: string; scanId: string; findingId: string; filePath: string; diff: string; rationale: string; regressionTest: string }) {
  const patchHash = createHash("sha256").update(input.diff, "utf8").digest("hex");
  const { data, error } = await admin.from("patches").insert({
    project_id: input.projectId,
    scan_id: input.scanId,
    finding_id: input.findingId,
    file_path: input.filePath.slice(0, 2048),
    diff: input.diff.slice(0, 24_000),
    rationale: input.rationale.slice(0, 1_200),
    regression_test: input.regressionTest.slice(0, 5_000),
    patch_hash: patchHash,
    status: "proposed",
    approval_required: true,
  }).select("id,file_path,patch_hash,status").single();
  const row = unwrap(data, error, "Patch proposal could not be recorded");
  await appendAuditEvent({ projectId: input.projectId, scanId: input.scanId, actor: "whitehat", type: "PATCH_PROPOSED", payload: { patchId: row.id, findingId: input.findingId, filePath: row.file_path, patchHash, humanApprovalRequired: true } });
  return row;
}

export async function claimPatchSandboxRun(admin: Db, input: { projectId: string; scanId: string; patchId: string; userId: string; expectedStatus: "proposed" | "approved" }) {
  let query = admin.from("patches").update({ sandbox_run_status: "running", ...(input.expectedStatus === "proposed" ? { status: "approved", approved_by: input.userId, approved_at: new Date().toISOString() } : {}) }).eq("id", input.patchId).eq("scan_id", input.scanId).eq("status", input.expectedStatus);
  query = input.expectedStatus === "proposed" ? query.eq("sandbox_run_status", "not-run") : query.in("sandbox_run_status", ["fail", "inconclusive"]);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) fail(error, "Sandbox patch review could not be claimed");
  if (!data) return false;
  await appendAuditEvent({ projectId: input.projectId, scanId: input.scanId, actor: "user", type: input.expectedStatus === "proposed" ? "PATCH_APPROVED" : "PATCH_SANDBOX_RETRY_STARTED", payload: { patchId: input.patchId, approvedBy: input.userId, humanApproval: true, sourceChanged: false } });
  return true;
}

export async function recordPatchSandboxOutcome(admin: Db, input: { projectId: string; scanId: string; targetId: string; patchId: string; status: "pass" | "fail" | "inconclusive"; verifierVersion: string; detail: string; evidenceIds: string[] }) {
  const detail = input.detail.slice(0, 4_000);
  const { error: verificationError } = await admin.from("verification_runs").insert({ project_id: input.projectId, scan_id: input.scanId, patch_id: input.patchId, check_type: "regression", status: input.status, verifier_version: input.verifierVersion.slice(0, 80), evidence_ids: input.evidenceIds.slice(0, 20), detail });
  if (verificationError) fail(verificationError, "Sandbox regression result could not be recorded");
  const { data, error } = await admin.from("patches").update({ status: input.status === "pass" ? "applied" : "approved", sandbox_run_status: input.status }).eq("id", input.patchId).eq("scan_id", input.scanId).eq("status", "approved").eq("sandbox_run_status", "running").select("id").maybeSingle();
  if (error) fail(error, "Sandbox patch status could not be recorded");
  if (!data) throw new Error("Sandbox patch review state changed before its result could be recorded");
  await appendAuditEvent({ projectId: input.projectId, scanId: input.scanId, targetId: input.targetId, actor: "orchestrator", type: "PATCH_SANDBOX_TESTED", payload: { patchId: input.patchId, status: input.status, verifierVersion: input.verifierVersion, sourceChanged: false, detail } });
}

export async function recordEvidence(admin: Db, input: { projectId: string; scanId: string; findingId?: string; kind: string; verified: boolean; commandHash: string; stdoutHash: string; stderrHash: string; exitCode: number | null; elapsedMs: number; boundedOutput: string; storagePath?: string }) {
  const id = randomUUID();
  const { error } = await admin.from("evidence").insert({ id, project_id: input.projectId, scan_id: input.scanId, finding_id: input.findingId ?? null, kind: input.kind, verified: input.verified, command_hash: input.commandHash, stdout_hash: input.stdoutHash, stderr_hash: input.stderrHash, exit_code: input.exitCode, elapsed_ms: input.elapsedMs, bounded_output: input.boundedOutput.slice(0, 16_384), storage_path: input.storagePath ?? null, retention_expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() });
  if (error) fail(error, "Evidence could not be recorded");
  return id;
}

export async function recordRound(admin: Db, scanId: string, roundNumber: number, checksInput: unknown, summary: string, evidenceHash: string, verifiedFindingCount: number) {
  const checks = RoundChecksSchema.parse(checksInput);
  const clean = !checks.inconclusive && checks.noNewVerifiedFindings === "pass" && checks.regression === "pass" && checks.previousExploitReplay === "pass" && checks.independentVerification === "pass";
  const { data: scan, error: readError } = await admin.from("scans").select("project_id,target_id,consecutive_clean_rounds").eq("id", scanId).single();
  const parent = unwrap(scan, readError, "Scan not found for round");
  const streak = clean ? Math.min(3, Number(parent.consecutive_clean_rounds) + 1) : 0;
  const { error } = await admin.from("scan_rounds").insert({ project_id: parent.project_id, scan_id: scanId, round_number: roundNumber, checks, clean, verified_finding_count: verifiedFindingCount, summary: summary.slice(0, 4000), evidence_hash: evidenceHash });
  if (error) fail(error, "Round could not be recorded");
  const { error: updateError } = await admin.from("scans").update({ round: roundNumber, consecutive_clean_rounds: streak, updated_at: new Date().toISOString() }).eq("id", scanId);
  if (updateError) fail(updateError, "Round counters could not be updated");
  await appendAuditEvent({ projectId: parent.project_id, scanId, targetId: parent.target_id, actor: "orchestrator", type: "ROUND_RECORDED", payload: { round: roundNumber, checks, clean, consecutiveCleanRounds: streak, verifiedFindingCount, evidenceHash } });
  return { clean, consecutiveCleanRounds: streak };
}
