import { createHash, randomUUID } from "node:crypto";
import {
  createRestrictedSandbox,
  downloadSandboxSourceFile,
  destroySandbox,
  indexSandboxSourceFiles,
  prepareSandboxWorkspace,
  runGuardedCommand,
  type SandboxHandle,
} from "@/lib/createos/client";
import { agentProvider } from "@/lib/agents/remote-provider";
import {
  BlackHatOutputSchema,
  OrchestratorOutputSchema,
  SentinelOutputSchema,
  WhiteHatOutputSchema,
} from "@/lib/agents/contracts";
import { recordAgentRun, getSessionForExecution, recordEvidence, recordPatchProposal, recordRound, recordSessionFinding, setSessionSandboxId, setSessionStatus, transitionSession } from "@/lib/db/repository";
import { appendAuditEvent } from "@/lib/events/audit";
import { registerSessionRun, unregisterSessionRun } from "@/lib/runner/active";
import { runApprovedScanners } from "@/lib/scanners/runner";
import { redactEvidenceText, redactPayload } from "@/lib/security/redaction";
import type { Finding } from "@/lib/schemas/contracts";
import { nextRound } from "@/lib/state-machine/engine";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateSingleFileDiff, validateSourcePath } from "@/lib/patches/validation";

export interface RunSessionInput {
  sessionId: string;
  targetId: string;
  projectId: string;
  ownerId: string;
  sourceArchive: Uint8Array | null;
  egressRules: string[];
  targetUrl: string | null;
  scopePaths: string[];
  accessMode: "source" | "url-only";
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const bounded = (value: unknown, limit = 14_000) => JSON.stringify(value).slice(0, limit);

async function agentRun<T>(input: {
  role: "blackhat" | "whitehat" | "sentinel" | "orchestrator";
  schema: Parameters<typeof agentProvider.generateJson<T>>[1];
  purpose: string;
  untrustedData: string;
  projectId: string;
  sessionId: string;
  signal: AbortSignal;
}) {
  const admin = createSupabaseAdminClient();
  const inputText = input.untrustedData.slice(0, 14_000);
  const runId = await recordAgentRun(admin, {
    projectId: input.projectId,
    scanId: input.sessionId,
    agentRole: input.role,
    status: "running",
    inputHash: sha256(inputText),
  });
  try {
    const response = await agentProvider.generateJson(
      { role: input.role, purpose: input.purpose, untrustedData: inputText, signal: input.signal },
      input.schema,
    );
    const safeResult = redactPayload(response.result);
    await recordAgentRun(admin, {
      projectId: input.projectId,
      scanId: input.sessionId,
      agentRole: input.role,
      status: "completed",
      model: response.model,
      inputHash: sha256(inputText),
      outputHash: sha256(JSON.stringify(safeResult)),
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      result: safeResult,
    });
    await appendAuditEvent({
      projectId: input.projectId,
      scanId: input.sessionId,
      actor: input.role,
      type: "AGENT_COMPLETED",
      payload: { runId, role: input.role, model: response.model, inputHash: sha256(inputText), outputHash: sha256(JSON.stringify(safeResult)) },
    });
    return safeResult as T;
  } catch (error) {
    await recordAgentRun(admin, {
      projectId: input.projectId,
      scanId: input.sessionId,
      agentRole: input.role,
      status: "inconclusive",
      errorCode: error instanceof Error ? error.name.slice(0, 80) : "UNKNOWN",
      result: { message: "Agent result unavailable; no claim was made." },
    }).catch(() => undefined);
    throw error;
  }
}

export async function runSession(input: RunSessionInput) {
  const controller = new AbortController();
  const admin = createSupabaseAdminClient();
  let sandbox: SandboxHandle | undefined;
  registerSessionRun(input.sessionId, controller);
  const stopPoll = setInterval(() => {
    void (async () => {
      try {
        const { data, error } = await admin.from("scans").select("status").eq("id", input.sessionId).maybeSingle();
        if (!error && data && ["stopped", "completed", "failed"].includes(data.status)) controller.abort();
      } catch { /* a transient status-read failure cannot stop the trusted runner */ }
    })();
  }, 1500);
  stopPoll.unref?.();
  try {
    const session = await getSessionForExecution(admin, input.sessionId);
    if (!session || session.projectId !== input.projectId || session.ownerId !== input.ownerId || session.targetId !== input.targetId) {
      throw new Error("Trusted session ownership check failed");
    }
    const roundNumber = nextRound(session.round, session.hardRoundLimit);
    if (roundNumber === null) {
      await setSessionStatus(admin, input.sessionId, "blocked", "The trusted round limit has been reached", "SESSION_BLOCKED", { reason: "round-limit-reached" });
      return;
    }
    await transitionSession(admin, input.sessionId, "BASELINE", { payload: { accessMode: input.accessMode, scopePaths: input.scopePaths } });
    if (!process.env.AGENT_API_KEY || !process.env.AGENT_MODEL) {
      await setSessionStatus(admin, input.sessionId, "blocked", "Agent model provider is not configured; no clean result was recorded", "SESSION_BLOCKED", { reason: "model-provider-not-configured" });
      return;
    }
    sandbox = await createRestrictedSandbox({ sessionId: input.sessionId, egressRules: input.egressRules, signal: controller.signal });
    await setSessionSandboxId(admin, input.sessionId, sandbox.id);
    await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "orchestrator", type: "SANDBOX_CREATED", payload: { egressRules: input.egressRules, egressVerified: true } });
    await prepareSandboxWorkspace(sandbox, input.sourceArchive);

    if (input.accessMode === "source" && session.sourceHash) {
      const actualHash = input.sourceArchive ? createHash("sha256").update(input.sourceArchive).digest("hex") : null;
      if (!actualHash || actualHash !== session.sourceHash) throw new Error("Source archive does not match the immutable session snapshot hash");
    }
    const workspaceCheck = await runGuardedCommand(sandbox, { command: "sh", args: ["-c", "test -d /workspace/target && printf 'source workspace is present'"], cwd: "/workspace", timeoutSeconds: 10, signal: controller.signal });
    await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "orchestrator", type: "WORKSPACE_PREPARED", payload: { status: workspaceCheck.status, exitCode: workspaceCheck.exitCode } });

    const sourceExcerpts: Array<{ path: string; evidenceId: string; sourceHash: string; text: string }> = [];
    if (session.sourceAnalysisConsented && input.accessMode === "source" && session.sourceHash) {
      try {
        const files = await indexSandboxSourceFiles(sandbox, controller.signal);
        for (const file of files.slice(0, 3)) {
          try {
            if (!validateSourcePath(file.path)) continue;
            const bytes = await downloadSandboxSourceFile(sandbox, file.path, 20_000);
            if (bytes.includes(0)) continue;
            const sourceHash = createHash("sha256").update(bytes).digest("hex");
            const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            const excerpt = redactEvidenceText(decoded, 4_000);
            const evidenceId = await recordEvidence(admin, {
              projectId: input.projectId,
              scanId: input.sessionId,
              kind: "source",
              verified: false,
              commandHash: sha256("trusted-source-index-v1"),
              stdoutHash: sourceHash,
              stderrHash: sha256(""),
              exitCode: 0,
              elapsedMs: 0,
              boundedOutput: `Source excerpt analyzed with explicit consent; path=${file.path}; sha256=${sourceHash}. Content is not stored.`,
              storagePath: file.path,
            });
            sourceExcerpts.push({ path: file.path, evidenceId, sourceHash, text: excerpt });
          } catch { /* unreadable or non-text source files are skipped */ }
        }
        await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "orchestrator", type: "SOURCE_ANALYSIS_COMPLETED", payload: { consented: true, excerptCount: sourceExcerpts.length, contentPersisted: false } });
      } catch {
        await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "orchestrator", type: "SOURCE_ANALYSIS_UNAVAILABLE", payload: { consented: true, reason: "bounded-source-index-failed", contentPersisted: false } });
      }
    }

    await transitionSession(admin, input.sessionId, "ATTACK");
    const scannerResults = input.targetUrl ? await runApprovedScanners({ sandbox, targetUrl: input.targetUrl, scopePaths: input.scopePaths, signal: controller.signal }) : [];
    const scannerEvidence = await Promise.all(scannerResults.map(async (result) => ({
      result,
      evidenceId: await recordEvidence(admin, {
        projectId: input.projectId,
        scanId: input.sessionId,
        kind: "scanner",
        verified: false,
        commandHash: sha256(`scanner:${result.scanner}`),
        stdoutHash: sha256(result.boundedOutput),
        stderrHash: sha256(""),
        exitCode: result.exitCode,
        elapsedMs: result.elapsedMs,
        boundedOutput: redactEvidenceText(result.boundedOutput, 16_384),
      }),
    })));
    const sourceEvidenceIds = new Set(sourceExcerpts.map((item) => item.evidenceId));
    const validEvidenceIds = new Set<string>([...scannerEvidence.map((item) => item.evidenceId), ...sourceEvidenceIds]);
    const attackContext = redactEvidenceText(bounded({ targetUrl: input.targetUrl, scopePaths: input.scopePaths, scannerResults: scannerEvidence.map(({ result, evidenceId }) => ({ ...result, evidenceId })), sourceExcerpts: sourceExcerpts.map(({ path, evidenceId, sourceHash, text }) => ({ path, evidenceId, sourceHash, text })), workspaceStatus: workspaceCheck.status }));
    const blackhat = await agentRun({ role: "blackhat", schema: BlackHatOutputSchema, purpose: "Perform bounded authorized discovery and distinguish observations from verified findings.", untrustedData: attackContext, projectId: input.projectId, sessionId: input.sessionId, signal: controller.signal });

    const candidateFindings: Finding[] = [];
    for (const observation of blackhat.observations) {
      const evidenceIds = observation.evidenceIds.filter((id) => validEvidenceIds.has(id));
      const finding: Finding = {
        id: randomUUID(),
        title: observation.title,
        severity: observation.severity,
        confidence: observation.confidence,
        status: evidenceIds.length > 0 ? "unverified" : "inconclusive",
        summary: observation.summary,
        ...(observation.path ? { targetPath: observation.path } : {}),
        evidenceIds,
        round: roundNumber,
        createdAt: new Date().toISOString(),
      };
      await recordSessionFinding(admin, input.sessionId, finding, "blackhat");
      candidateFindings.push(finding);
    }

    const patchEligibleFindings = candidateFindings.filter((finding) => finding.status === "unverified" && finding.evidenceIds.some((id) => sourceEvidenceIds.has(id)));
    if (patchEligibleFindings.length > 0 && sourceExcerpts.length > 0 && session.sourceAnalysisConsented) {
      try {
        const whitehat = await agentRun({
          role: "whitehat",
          schema: WhiteHatOutputSchema,
          purpose: "Suggest minimal patches only for evidence-backed, explicitly unverified candidate findings. Include a focused regression script. Never claim the finding is verified.",
          untrustedData: redactEvidenceText(bounded({ candidates: patchEligibleFindings, sourceExcerpts: sourceExcerpts.map(({ path, evidenceId, sourceHash, text }) => ({ path, evidenceId, sourceHash, text })), constraints: "Only propose a single-file source diff for one of the shown files. Findings remain unverified. Human review of both diff and script is mandatory. The approved patch and script will run only in a disposable source copy." })),
          projectId: input.projectId,
          sessionId: input.sessionId,
          signal: controller.signal,
        });
        const findingById = new Map(patchEligibleFindings.map((finding) => [finding.id, finding]));
        const sourcePaths = new Set(sourceExcerpts.map((excerpt) => excerpt.path));
        const seenFindings = new Set<string>();
        let savedProposals = 0;
        for (const proposal of whitehat.proposals) {
          const finding = findingById.get(proposal.findingId);
          if (!finding || seenFindings.has(finding.id) || !sourcePaths.has(proposal.filePath) || !validateSourcePath(proposal.filePath) || !validateSingleFileDiff(proposal.unifiedDiff, proposal.filePath) || !proposal.regressionTest.trim() || proposal.regressionTest.includes("\0")) continue;
          if (!finding.evidenceIds.some((id) => sourceEvidenceIds.has(id))) continue;
          seenFindings.add(finding.id);
          await recordPatchProposal(admin, { projectId: input.projectId, scanId: input.sessionId, findingId: finding.id, filePath: proposal.filePath, diff: proposal.unifiedDiff, rationale: proposal.rationale, regressionTest: proposal.regressionTest });
          savedProposals += 1;
        }
        await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "whitehat", type: "WHITEHAT_PROPOSALS_REVIEWED", payload: { proposalsReturned: whitehat.proposals.length, proposalsPersisted: savedProposals, findingsRemainUnverified: true, humanApprovalRequired: true } });
      } catch {
        await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "whitehat", type: "WHITEHAT_PROPOSAL_UNAVAILABLE", payload: { reason: "proposal-generation-or-validation-failed", findingsRemainUnverified: true } });
      }
    }

    await transitionSession(admin, input.sessionId, "VERIFY");
    const sentinel = await agentRun({ role: "sentinel", schema: SentinelOutputSchema, purpose: "Assess candidates and evidence. A model verdict alone cannot independently verify a finding.", untrustedData: redactEvidenceText(bounded({ candidates: candidateFindings, blackhat, scannerEvidence, workspaceStatus: workspaceCheck.status, workspaceExitCode: workspaceCheck.exitCode })), projectId: input.projectId, sessionId: input.sessionId, signal: controller.signal });
    const verifiedCount = 0; // No deterministic exploit reproducer is configured; never trust a model verdict as verification.
    await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "orchestrator", type: "VERIFICATION_GATE_UNAVAILABLE", payload: { modelVerdict: sentinel.verdict, verifiedFindingCount: 0, reason: "deterministic-verifier-not-configured" } });

    const checks = {
      noNewVerifiedFindings: "inconclusive",
      regression: "not-run",
      previousExploitReplay: "not-run",
      independentVerification: "inconclusive",
      inconclusive: true,
    } as const;
    await transitionSession(admin, input.sessionId, "RECORD");
    await recordRound(admin, input.sessionId, roundNumber, checks, "No automatic clean claim; deterministic verification, build, regression, and exploit replay gates are not configured.", sha256(JSON.stringify({ blackhat, sentinel, scannerResults })), verifiedCount);
    await transitionSession(admin, input.sessionId, "CONTINUE_OR_STOP", { status: "blocked", stopReason: "Required trusted verification gates are not configured", payload: { checks } });
    const orchestrator = await agentRun({ role: "orchestrator", schema: OrchestratorOutputSchema, purpose: "Recommend only a server-allowed next action from trusted state.", untrustedData: bounded({ checks, sessionState: "CONTINUE_OR_STOP" }), projectId: input.projectId, sessionId: input.sessionId, signal: controller.signal });
    await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "orchestrator", type: "ORCHESTRATOR_RECOMMENDATION", payload: orchestrator });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : "Unknown trusted runner failure";
    await setSessionStatus(admin, input.sessionId, controller.signal.aborted ? "stopped" : "failed", message, controller.signal.aborted ? "SESSION_STOPPED" : "SESSION_FAILED", { error: message }).catch(() => undefined);
  } finally {
    if (sandbox) {
      await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "orchestrator", type: "SANDBOX_DESTROY_STARTED", payload: {} }).catch(() => undefined);
      await destroySandbox(sandbox).catch(() => undefined);
      await setSessionSandboxId(admin, input.sessionId, null).catch(() => undefined);
      await appendAuditEvent({ projectId: input.projectId, scanId: input.sessionId, targetId: input.targetId, actor: "orchestrator", type: "SANDBOX_DESTROYED", payload: {} }).catch(() => undefined);
    }
    clearInterval(stopPoll);
    unregisterSessionRun(input.sessionId, controller);
  }
}
