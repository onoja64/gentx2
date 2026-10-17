import { z } from "zod";
import { uploadSandboxFile, runGuardedCommand, type SandboxHandle } from "@/lib/createos/client";
import { nucleiTargetForScope } from "@/lib/scanners/scope";
import { redactEvidenceText } from "@/lib/security/redaction";

const MAX_SCANNER_OUTPUT = 16_384;
const NucleiFindingSchema = z.object({
  templateID: z.string().max(240).optional(),
  template: z.string().max(240).optional(),
  info: z.object({ name: z.string().max(240).optional(), severity: z.string().max(32).optional(), description: z.string().max(2000).optional() }).passthrough().optional(),
  matchedAt: z.string().max(2048).optional(),
  type: z.string().max(32).optional(),
}).passthrough();

export interface ScannerResult {
  scanner: "zap" | "nuclei";
  status: "pass" | "findings" | "inconclusive";
  exitCode: number | null;
  elapsedMs: number;
  boundedOutput: string;
  candidateCount: number;
  reason?: string;
}

export function buildNucleiArgs(targetUrl: string) {
  return [
    "-u", targetUrl,
    "-jsonl",
    "-disable-update-check",
    "-disable-redirects",
    "-concurrency", "1",
    "-bulk-size", "1",
    "-rate-limit", "1",
    "-retries", "0",
    "-timeout", "5",
    "-max-host-error", "1",
    "-no-color",
    "-tags", "misconfig,exposure,tech",
    "-severity", "info,low,medium,high,critical",
  ];
}

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function buildZapAutomationPlan(targetUrl: string, scopePaths: string[]) {
  const base = new URL(targetUrl);
  const includePaths = scopePaths.map((path) => `${escapeRegex(new URL(path, base.origin).toString().replace(/\/$/, ""))}(?:/[^?#]*)?`);
  const plan = {
    env: {
      contexts: [{
        name: "gentx2-authorized-scope",
        urls: [base.origin],
        includePaths,
      }],
    },
    jobs: [
      {
        type: "spider",
        parameters: { context: "gentx2-authorized-scope", url: targetUrl, maxDuration: 1, maxDepth: 2, maxChildren: 20, acceptCookies: false },
      },
      { type: "passiveScan-wait", parameters: { maxDuration: 1 } },
      {
        type: "report",
        parameters: { template: "traditional-json", reportDir: "/workspace/results", reportFile: "zap-report.json", reportTitle: "GentX2 bounded passive assessment", reportDescription: "Authorized scope only; passive ZAP baseline." },
      },
    ],
  };
  return `${JSON.stringify(plan, null, 2)}\n`;
}

function parseNuclei(output: string) {
  const findings: Array<z.infer<typeof NucleiFindingSchema>> = [];
  let malformed = 0;
  for (const line of output.split("\n").slice(0, 200)) {
    if (!line.trim()) continue;
    const parsed = NucleiFindingSchema.safeParse(safeJson(line));
    if (parsed.success) findings.push(parsed.data); else malformed += 1;
  }
  return { findings, malformed };
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

export async function runApprovedScanners(input: { sandbox: SandboxHandle; targetUrl: string; scopePaths: string[]; signal?: AbortSignal }): Promise<ScannerResult[]> {
  const results: ScannerResult[] = [];
  const nucleiTarget = nucleiTargetForScope(input.targetUrl, input.scopePaths);
  if (!nucleiTarget) {
    results.push({ scanner: "nuclei", status: "inconclusive", exitCode: null, elapsedMs: 0, boundedOutput: "Nuclei skipped because the declared path scope does not authorize the entire origin.", candidateCount: 0, reason: "path-scope-too-narrow" });
  }
  const nucleiAvailable = nucleiTarget
    ? await runGuardedCommand(input.sandbox, { command: "sh", args: ["-c", "command -v nuclei"], cwd: "/workspace", timeoutSeconds: 5, signal: input.signal })
    : null;
  const zapAvailable = await runGuardedCommand(input.sandbox, { command: "sh", args: ["-c", "command -v zap.sh"], cwd: "/workspace", timeoutSeconds: 5, signal: input.signal });

  if (nucleiTarget && nucleiAvailable && (nucleiAvailable.status !== "complete" || nucleiAvailable.exitCode !== 0)) {
    results.push({ scanner: "nuclei", status: "inconclusive", exitCode: null, elapsedMs: nucleiAvailable.elapsedMs, boundedOutput: "Nuclei is not installed in this CreateOS rootfs; no scan was claimed.", candidateCount: 0, reason: "scanner-not-installed" });
  } else if (nucleiTarget && nucleiAvailable) {
    const scan = await runGuardedCommand(input.sandbox, { command: "nuclei", args: buildNucleiArgs(nucleiTarget), cwd: "/workspace", timeoutSeconds: 120, signal: input.signal });
    const parsed = parseNuclei(scan.stdout);
    const status = scan.status !== "complete" || parsed.malformed > 0 ? "inconclusive" : parsed.findings.length > 0 ? "findings" : scan.exitCode === 0 ? "pass" : "inconclusive";
    results.push({ scanner: "nuclei", status, exitCode: scan.exitCode, elapsedMs: scan.elapsedMs, boundedOutput: redactEvidenceText(scan.stdout, MAX_SCANNER_OUTPUT), candidateCount: parsed.findings.length, ...(status === "inconclusive" ? { reason: scan.status === "complete" ? "nuclei-exit-or-parse-failure" : scan.status } : {}) });
  }

  if (zapAvailable.status !== "complete" || zapAvailable.exitCode !== 0) {
    results.push({ scanner: "zap", status: "inconclusive", exitCode: null, elapsedMs: zapAvailable.elapsedMs, boundedOutput: "OWASP ZAP is not installed in this CreateOS rootfs; no scan was claimed.", candidateCount: 0, reason: "scanner-not-installed" });
  } else {
    await uploadSandboxFile(input.sandbox, "/opt/gentx2/zap-plan.yaml", buildZapAutomationPlan(input.targetUrl, input.scopePaths));
    const scan = await runGuardedCommand(input.sandbox, { command: "zap.sh", args: ["-cmd", "-autorun", "/opt/gentx2/zap-plan.yaml"], cwd: "/workspace", timeoutSeconds: 180, signal: input.signal });
    const status = scan.status === "complete" && scan.exitCode === 0 ? "pass" : "inconclusive";
    results.push({ scanner: "zap", status, exitCode: scan.exitCode, elapsedMs: scan.elapsedMs, boundedOutput: redactEvidenceText(scan.stdout + (scan.stderr ? `\n${scan.stderr}` : ""), MAX_SCANNER_OUTPUT), candidateCount: 0, ...(status === "inconclusive" ? { reason: scan.status === "complete" ? "zap-exit-failure" : scan.status } : {}) });
  }
  return results;
}
