import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { appendAuditEvent } from "@/lib/events/audit";
import { attachClaimedSessionSandbox, claimPatchSandboxRun, claimSessionSandboxSlot, getTarget, recordEvidence, recordPatchSandboxOutcome, releaseClaimedSessionSandbox } from "@/lib/db/repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { downloadPublicGitHubArchive, sha256 } from "@/lib/intake/github";
import { RequestTooLargeError, readBoundedFormData } from "@/lib/security/bounded-form";
import { createRestrictedSandbox, destroySandbox, prepareSandboxWorkspace, runGuardedCommand, uploadSandboxFile, type SandboxHandle } from "@/lib/createos/client";
import { redactEvidenceText } from "@/lib/security/redaction";
import { validateSingleFileDiff, validateSourcePath } from "@/lib/patches/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_ARCHIVE_BYTES + 64 * 1024;
const PATCH_VERIFIER_VERSION = "createos-bounded-regression-v1";
const hashText = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function leavePatchRetryable(admin: ReturnType<typeof createSupabaseAdminClient>, patchId: string, status: "approved" | "proposed") {
  try {
    await admin.from("patches").update({ status, sandbox_run_status: "inconclusive" }).eq("id", patchId).eq("sandbox_run_status", "running");
  } catch { /* best-effort recovery leaves the audit trail as the source of truth */ }
}

export async function POST(request: Request, context: { params: Promise<{ id: string; patchId: string }> }) {
  const { id, patchId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(patchId)) return NextResponse.json({ error: "Invalid scan or patch ID" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let form: FormData;
  try { form = await readBoundedFormData(request, MAX_FORM_BYTES); }
  catch (error) {
    if (error instanceof RequestTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    return NextResponse.json({ error: "Explicit sandbox review approval is required" }, { status: 400 });
  }
  if (form.get("approved") !== "true") return NextResponse.json({ error: "Review the diff and regression script, then explicitly approve the sandbox run" }, { status: 400 });

  const { data: patch, error: patchError } = await supabase.from("patches").select("id,project_id,scan_id,finding_id,file_path,diff,rationale,patch_hash,regression_test,status,sandbox_run_status").eq("id", patchId).eq("scan_id", id).maybeSingle();
  if (patchError) return NextResponse.json({ error: "Patch lookup is unavailable" }, { status: 503 });
  if (!patch) return NextResponse.json({ error: "Patch not found" }, { status: 404 });
  if (patch.status !== "proposed" && patch.status !== "approved") return NextResponse.json({ error: "This patch can no longer be reviewed" }, { status: 409 });
  if (patch.status === "approved" && !["fail", "inconclusive"].includes(patch.sandbox_run_status)) return NextResponse.json({ error: "A sandbox check is already running or has passed" }, { status: 409 });
  if (!validateSourcePath(patch.file_path) || !validateSingleFileDiff(patch.diff, patch.file_path) || typeof patch.rationale !== "string" || patch.rationale.length > 1_200 || typeof patch.regression_test !== "string" || !patch.regression_test.trim() || patch.regression_test.length > 5_000 || patch.regression_test.includes("\0") || hashText(patch.diff) !== patch.patch_hash) {
    return NextResponse.json({ error: "The stored proposal failed source-only safety validation" }, { status: 409 });
  }

  const { data: scan, error: scanError } = await supabase.from("scans").select("project_id,target_id,status,sandbox_id,source_hash,source_analysis_consented").eq("id", id).maybeSingle();
  if (scanError) return NextResponse.json({ error: "Session authorization could not be checked" }, { status: 503 });
  if (!scan || scan.project_id !== patch.project_id) return NextResponse.json({ error: "Session was not found in this workspace" }, { status: 404 });
  if (scan.status === "running" || scan.sandbox_id) return NextResponse.json({ error: "Wait for the active session sandbox to finish and clean up before reviewing a patch" }, { status: 409 });
  if (scan.source_analysis_consented !== true || typeof scan.source_hash !== "string") return NextResponse.json({ error: "This session has no explicit source-analysis consent or immutable source snapshot" }, { status: 409 });

  const target = await getTarget(supabase, scan.target_id);
  if (!target || target.accessMode !== "source") return NextResponse.json({ error: "Sandbox patch review is limited to authorized source-backed targets" }, { status: 409 });
  const { data: finding, error: findingError } = await supabase.from("findings").select("id,status,evidence_ids").eq("id", patch.finding_id).eq("scan_id", id).maybeSingle();
  if (findingError) return NextResponse.json({ error: "Finding evidence could not be checked" }, { status: 503 });
  if (!finding || finding.status !== "unverified" || !Array.isArray(finding.evidence_ids)) return NextResponse.json({ error: "Only an unverified, evidence-backed finding can have a source patch proposal" }, { status: 409 });
  const { data: sourceEvidence, error: evidenceError } = await supabase.from("evidence").select("id").eq("scan_id", id).eq("kind", "source").eq("storage_path", patch.file_path).in("id", finding.evidence_ids);
  if (evidenceError) return NextResponse.json({ error: "Source evidence could not be checked" }, { status: 503 });
  if (!sourceEvidence?.length) return NextResponse.json({ error: "The finding is not linked to an analyzed source excerpt" }, { status: 409 });

  let sourceArchive: Uint8Array;
  try {
    if (target.kind === "archive") {
      const file = form.get("sourceArchive");
      if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".zip") || file.size < 4 || file.size > MAX_ARCHIVE_BYTES) return NextResponse.json({ error: "Re-select the exact authorized ZIP/folder source before sandbox review" }, { status: 400 });
      sourceArchive = new Uint8Array(await file.arrayBuffer());
      if (sourceArchive[0] !== 0x50 || sourceArchive[1] !== 0x4b) return NextResponse.json({ error: "Source upload is not a ZIP archive" }, { status: 400 });
    } else if (target.kind === "github" && target.sourceReference) {
      const downloaded = await downloadPublicGitHubArchive(target.sourceReference, AbortSignal.timeout(25_000));
      sourceArchive = downloaded.archive;
      if (downloaded.sourceHash !== scan.source_hash) return NextResponse.json({ error: "GitHub source changed since this session; create a fresh session before sandbox review" }, { status: 409 });
    } else {
      return NextResponse.json({ error: "This source type cannot be reloaded for an exact-snapshot sandbox review" }, { status: 409 });
    }
    if (await sha256(sourceArchive) !== scan.source_hash) return NextResponse.json({ error: "Source hash does not match this session snapshot" }, { status: 409 });
  } catch (error) {
    if (error instanceof RequestTooLargeError) return NextResponse.json({ error: error.message }, { status: 413 });
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 240) : "Exact source snapshot could not be loaded" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const slotToken = `patch-review:${randomUUID()}`;
  let slotClaimed = false;
  try { slotClaimed = await claimSessionSandboxSlot(admin, id, slotToken); }
  catch {
    await releaseClaimedSessionSandbox(admin, id, slotToken).catch(() => undefined);
    return NextResponse.json({ error: "Session sandbox slot could not be locked safely" }, { status: 503 });
  }
  if (!slotClaimed) return NextResponse.json({ error: "Another sandbox is active for this session; reload after cleanup" }, { status: 409 });
  const expectedStatus = patch.status as "proposed" | "approved";
  let claimed = false;
  try { claimed = await claimPatchSandboxRun(admin, { projectId: patch.project_id, scanId: id, patchId, userId: user.id, expectedStatus }); }
  catch {
    await leavePatchRetryable(admin, patchId, "approved");
    await releaseClaimedSessionSandbox(admin, id, slotToken).catch(() => undefined);
    return NextResponse.json({ error: "Patch review approval could not be recorded safely" }, { status: 503 });
  }
  if (!claimed) {
    await releaseClaimedSessionSandbox(admin, id, slotToken).catch(() => undefined);
    return NextResponse.json({ error: "Patch review state changed concurrently; reload the report" }, { status: 409 });
  }

  let sandbox: SandboxHandle | undefined;
  let releaseSlot = true;
  let outcome: "pass" | "fail" | "inconclusive" = "inconclusive";
  let output = "";
  let detail = "The sandbox regression check did not complete.";
  try {
    sandbox = await createRestrictedSandbox({ sessionId: `${id}-patch-${patchId}`, egressRules: ["127.0.0.1:4177"] });
    await attachClaimedSessionSandbox(admin, id, slotToken, sandbox.id);
    await appendAuditEvent({ projectId: patch.project_id, scanId: id, targetId: scan.target_id, actor: "orchestrator", type: "PATCH_SANDBOX_CREATED", payload: { patchId, egressVerified: true, sourceChanged: false } });
    await prepareSandboxWorkspace(sandbox, sourceArchive);

    await uploadSandboxFile(sandbox, "/workspace/tmp/whitehat.patch", patch.diff);
    const patchPermissions = await sandbox.runCommand("chmod", ["0644", "/workspace/tmp/whitehat.patch"], { timeoutMs: 10_000, retry: false });
    if (patchPermissions.result.exit_code !== 0) throw new Error("Patch file could not be prepared in the sandbox");
    const applied = await runGuardedCommand(sandbox, { command: "python3", args: ["/opt/gentx2/apply-patch.py"], cwd: "/workspace/target", timeoutSeconds: 35 });
    output = [applied.stdout, applied.stderr].filter(Boolean).join("\n");
    if (applied.status !== "complete" || applied.exitCode !== 0) {
      outcome = "inconclusive";
      detail = `Patch application did not complete (${applied.status}; exit code ${applied.exitCode}). The regression script did not run. ${redactEvidenceText(output, 2_500)}`.slice(0, 4_000);
    } else {
      await uploadSandboxFile(sandbox, "/workspace/tmp/whitehat-regression.sh", patch.regression_test);
      const testPermissions = await sandbox.runCommand("chmod", ["0644", "/workspace/tmp/whitehat-regression.sh"], { timeoutMs: 10_000, retry: false });
      if (testPermissions.result.exit_code !== 0) throw new Error("Regression script could not be prepared in the sandbox");
      const regression = await runGuardedCommand(sandbox, { command: "sh", args: ["/workspace/tmp/whitehat-regression.sh"], cwd: "/workspace/target", timeoutSeconds: 120 });
      output = [regression.stdout, regression.stderr].filter(Boolean).join("\n");
      outcome = regression.status !== "complete" ? "inconclusive" : regression.exitCode === 0 ? "pass" : "fail";
      detail = `Reviewed regression script status=${regression.status}; exit code=${regression.exitCode}. This records only the script process result; it does not independently verify the finding. ${redactEvidenceText(output, 2_500)}`.slice(0, 4_000);
    }
  } catch (error) {
    outcome = "inconclusive";
    detail = `Sandbox execution was inconclusive (${error instanceof Error ? error.name : "unknown error"}); no original source was changed.`;
  } finally {
    if (sandbox) {
      await appendAuditEvent({ projectId: patch.project_id, scanId: id, targetId: scan.target_id, actor: "orchestrator", type: "PATCH_SANDBOX_DESTROY_STARTED", payload: { patchId } }).catch(() => undefined);
      try {
        await destroySandbox(sandbox);
        await releaseClaimedSessionSandbox(admin, id, slotToken, sandbox.id);
        await appendAuditEvent({ projectId: patch.project_id, scanId: id, targetId: scan.target_id, actor: "orchestrator", type: "PATCH_SANDBOX_DESTROYED", payload: { patchId } });
      } catch {
        releaseSlot = false;
        outcome = "inconclusive";
        detail = "Sandbox cleanup could not be confirmed; the source repository was not changed. Check CreateOS before retrying.";
        await appendAuditEvent({ projectId: patch.project_id, scanId: id, targetId: scan.target_id, actor: "orchestrator", type: "PATCH_SANDBOX_CLEANUP_UNCONFIRMED", payload: { patchId } }).catch(() => undefined);
      }
    }
    if (!sandbox || releaseSlot) await releaseClaimedSessionSandbox(admin, id, slotToken).catch(() => undefined);
  }

  const safeOutput = redactEvidenceText(output, 8_000);
  let evidenceIds: string[] = [];
  try {
    const evidenceId = await recordEvidence(admin, {
      projectId: patch.project_id,
      scanId: id,
      findingId: patch.finding_id,
      kind: "regression",
      verified: false,
      commandHash: hashText("trusted-bounded-runner:patch-and-regression-v1"),
      stdoutHash: hashText(safeOutput),
      stderrHash: hashText(""),
      exitCode: outcome === "pass" ? 0 : outcome === "fail" ? 1 : null,
      elapsedMs: 0,
      boundedOutput: `Disposable sandbox patch check; status=${outcome}; output=${safeOutput}`,
    });
    evidenceIds = [evidenceId];
  } catch {
    outcome = "inconclusive";
    detail = "Sandbox result could not be fully persisted; it does not verify the finding or change the original source.";
  }
  try {
    await recordPatchSandboxOutcome(admin, { projectId: patch.project_id, scanId: id, targetId: scan.target_id, patchId, status: outcome, verifierVersion: PATCH_VERIFIER_VERSION, detail, evidenceIds });
  } catch {
    await leavePatchRetryable(admin, patchId, "approved");
    return NextResponse.json({ error: "Sandbox result persistence failed; retry after checking the session report" }, { status: 503 });
  }
  return NextResponse.json({ approved: true, patchId, status: outcome === "pass" ? "applied" : "approved", sandboxRunStatus: outcome, detail }, { headers: { "cache-control": "no-store" } });
}
