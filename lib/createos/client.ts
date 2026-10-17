import { createClient } from "@nodeops-createos/sandbox";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isWorkspaceDirectory } from "./paths";

const REQUEST_TIMEOUT_MS = 30_000;
const SHAPE = "s-1vcpu-1gb";
const ROOTFS = "devbox:1";
const MAX_COMMAND_TIMEOUT_SECONDS = 180;
const MAX_GUARDED_OUTPUT_BYTES = 8 * 1024;

export type SandboxHandle = Awaited<ReturnType<ReturnType<typeof createClient>["createSandbox"]>>;
export type GuardedCommandResult = z.infer<typeof GuardedCommandResultSchema>;
const GuardedCommandResultSchema = z.object({
  status: z.enum(["complete", "timeout", "output-limit", "start-failed", "rejected", "spawned"]),
  stdout: z.string().max(MAX_GUARDED_OUTPUT_BYTES),
  stderr: z.string().max(MAX_GUARDED_OUTPUT_BYTES),
  exitCode: z.number().int().min(-255).max(255),
  elapsedMs: z.number().int().nonnegative().max(5 * 60 * 1000),
  pid: z.number().int().positive().optional(),
});

let cachedClient: ReturnType<typeof createClient> | undefined;
export function getClient() {
  if (typeof window !== "undefined") throw new Error("CreateOS access is server-only");
  const apiKey = process.env.CREATEOS_SANDBOX_API_KEY;
  if (!apiKey) throw new Error("CreateOS is not configured");
  cachedClient ??= createClient({ apiKey, timeoutMs: REQUEST_TIMEOUT_MS, retry: false });
  return cachedClient;
}

export function validateEgressRules(input: string[]) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 64) throw new Error("CreateOS requires 1–64 explicit egress rules");
  const rules = [...new Set(input)];
  for (const rule of rules) {
    if (rule.length > 260 || /[\s*\/\\]/.test(rule)) throw new Error("Egress must contain exact host:port rules; wildcards and CIDRs are forbidden");
    const separator = rule.lastIndexOf(":");
    if (separator < 1) throw new Error("Malformed host:port egress rule");
    const rawHost = rule.slice(0, separator);
    const host = rawHost.replace(/^\[|\]$/g, "");
    const port = Number(rule.slice(separator + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !host || host === "0.0.0.0" || host === "::") throw new Error("Invalid or open egress rule");
    if (host.includes(":") && (!rawHost.startsWith("[") || !rawHost.endsWith("]"))) throw new Error("IPv6 egress hosts must be bracketed");
  }
  return rules.sort();
}

export async function createRestrictedSandbox(input: { sessionId: string; egressRules: string[]; signal?: AbortSignal }) {
  const rules = validateEgressRules(input.egressRules);
  const name = `g2-${input.sessionId.replaceAll("-", "").slice(0, 8)}-${randomBytes(3).toString("hex")}`;
  const client = getClient();
  let sandbox: SandboxHandle | undefined;
  try {
    sandbox = await client.createSandbox({
      name,
      shape: SHAPE,
      rootfs: ROOTFS,
      egress: rules,
      auto_pause_after_seconds: 900,
    }, { timeoutMs: 120_000, retry: false, signal: input.signal });
    await sandbox.waitUntilRunning({ timeoutMs: 120_000, request: { timeoutMs: REQUEST_TIMEOUT_MS, retry: false, signal: input.signal } });
    const current = await sandbox.getEgress({ timeoutMs: REQUEST_TIMEOUT_MS, retry: false, signal: input.signal });
    if (!sameRules(current.egress, rules)) {
      await sandbox.setEgress(rules, { timeoutMs: REQUEST_TIMEOUT_MS, retry: false, signal: input.signal });
      const verified = await sandbox.getEgress({ timeoutMs: REQUEST_TIMEOUT_MS, retry: false, signal: input.signal });
      if (!sameRules(verified.egress, rules)) throw new Error("CreateOS egress policy did not match the authorized scope");
    }
    return sandbox;
  } catch (error) {
    if (sandbox) await destroySandbox(sandbox).catch(() => undefined);
    throw error;
  }
}

function sameRules(actual: string[] | undefined, expected: string[]) {
  return Boolean(actual && actual.length === expected.length && [...actual].sort().every((rule, index) => rule === expected[index]));
}

export async function destroySandbox(sandbox: SandboxHandle) {
  if (sandbox.status === "destroyed" || sandbox.status === "failed") return;
  await sandbox.destroy({ timeoutMs: REQUEST_TIMEOUT_MS, retry: false });
  await sandbox.waitUntilDestroyed({ timeoutMs: 90_000, request: { timeoutMs: REQUEST_TIMEOUT_MS, retry: false } });
}

export async function uploadSandboxFile(sandbox: SandboxHandle, path: string, bytes: Uint8Array | string) {
  if (!path.startsWith("/") || path.split("/").includes("..") || !(path.startsWith("/workspace/") || path.startsWith("/opt/gentx2/"))) throw new Error("Sandbox upload path is outside the approved workspace");
  const content = typeof bytes === "string"
    ? new Blob([bytes], { type: "text/plain; charset=utf-8" })
    : new Blob([Uint8Array.from(bytes).buffer], { type: "application/octet-stream" });
  await sandbox.files.upload(path, content, { timeoutMs: Math.max(30_000, Math.min(120_000, Math.ceil(content.size / (1024 * 1024)) * 5_000)), retry: false });
}

export async function prepareSandboxWorkspace(sandbox: SandboxHandle, sourceArchive?: Uint8Array | null) {
  const setup = await sandbox.runCommand("sh", ["-c", "mkdir -p /opt/gentx2 /workspace/target /workspace/home /workspace/tmp && chown -R 65534:65534 /workspace && chmod 755 /opt/gentx2 && getent passwd 65534 >/dev/null"], { timeoutMs: 15_000, retry: false });
  if (setup.result.exit_code !== 0) throw new Error("CreateOS guest did not provide the required unprivileged runner account");
  const scriptsDir = join(process.cwd(), "scripts");
  const runner = await readFile(join(scriptsDir, "createos-command-runner.py"));
  const extractor = await readFile(join(scriptsDir, "createos-extract-zip.py"));
  const sourceIndexer = await readFile(join(scriptsDir, "createos-source-index.py"));
  const patchApplier = await readFile(join(scriptsDir, "createos-apply-patch.py"));
  await uploadSandboxFile(sandbox, "/opt/gentx2/command-runner.py", runner);
  await uploadSandboxFile(sandbox, "/opt/gentx2/extract-zip.py", extractor);
  await uploadSandboxFile(sandbox, "/opt/gentx2/source-index.py", sourceIndexer);
  await uploadSandboxFile(sandbox, "/opt/gentx2/apply-patch.py", patchApplier);
  const secureFiles = await sandbox.runCommand("sh", ["-c", "chown root:root /opt/gentx2/command-runner.py /opt/gentx2/extract-zip.py /opt/gentx2/source-index.py /opt/gentx2/apply-patch.py && chmod 0555 /opt/gentx2/command-runner.py /opt/gentx2/extract-zip.py /opt/gentx2/source-index.py /opt/gentx2/apply-patch.py"], { timeoutMs: 10_000, retry: false });
  if (secureFiles.result.exit_code !== 0) throw new Error("CreateOS trusted runner files could not be write-protected");

  if (sourceArchive) {
    await uploadSandboxFile(sandbox, "/workspace/upload.zip", sourceArchive);
    const readable = await sandbox.runCommand("chmod", ["0644", "/workspace/upload.zip"], { timeoutMs: 10_000, retry: false });
    if (readable.result.exit_code !== 0) throw new Error("CreateOS archive could not be made readable by the isolated runner");
    const extracted = await runGuardedCommand(sandbox, {
      command: "python3",
      args: ["/opt/gentx2/extract-zip.py", "/workspace/upload.zip", "/workspace/target"],
      cwd: "/workspace",
      timeoutSeconds: 60,
    });
    if (extracted.status !== "complete" || extracted.exitCode !== 0) throw new Error(`CreateOS archive extraction was ${extracted.status}`);
    return { extracted: true, summary: extracted.stdout.trim().slice(0, 160) };
  }
  return { extracted: false, summary: "No source archive supplied" };
}

export interface SandboxSourceFile { path: string; size: number }

export async function indexSandboxSourceFiles(sandbox: SandboxHandle, signal?: AbortSignal): Promise<SandboxSourceFile[]> {
  const result = await runGuardedCommand(sandbox, {
    command: "python3",
    args: ["/opt/gentx2/source-index.py"],
    cwd: "/workspace",
    timeoutSeconds: 10,
    signal,
  });
  if (result.status !== "complete" || result.exitCode !== 0 || result.stdout.length > 7_500) throw new Error("Source file index could not be read safely");
  const parsed: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(parsed) || parsed.length > 40) throw new Error("Source file index was invalid");
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.path !== "string" || !Number.isSafeInteger(item.size) || Number(item.size) < 1 || Number(item.size) > 20_000) return [];
    return [{ path: item.path, size: Number(item.size) }];
  });
}

export async function downloadSandboxSourceFile(sandbox: SandboxHandle, relativePath: string, maximumBytes = 20_000) {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Source file path is outside the indexed workspace");
  }
  const file = await sandbox.files.download(`/workspace/target/${relativePath}`, { timeoutMs: REQUEST_TIMEOUT_MS, retry: false });
  if (file.byteLength > maximumBytes) throw new Error("Indexed source file exceeds the excerpt limit");
  return new Uint8Array(file);
}

export async function runGuardedCommand(sandbox: SandboxHandle, input: { command: string; args?: string[]; cwd: string; timeoutSeconds: number; signal?: AbortSignal }) {
  const timeoutSeconds = Math.max(1, Math.min(MAX_COMMAND_TIMEOUT_SECONDS, Math.floor(input.timeoutSeconds)));
  const args = input.args ?? [];
  const totalBytes = [input.command, ...args].reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0);
  if (args.length > 256 || totalBytes > 16 * 1024 || [input.command, ...args].some((value) => value.includes("\0"))) throw new Error("Command argument budget exceeded");
  if (!isWorkspaceDirectory(input.cwd)) throw new Error("Command working directory is outside the workspace");
  const response = await sandbox.runCommand("python3", ["/opt/gentx2/command-runner.py", "--timeout", String(timeoutSeconds), "--cwd", input.cwd, "--", input.command, ...args], {
    timeoutMs: (timeoutSeconds + 12) * 1000,
    retry: false,
    signal: input.signal,
  });
  try {
    const parsed = GuardedCommandResultSchema.parse(JSON.parse(response.result.stdout));
    return parsed;
  } catch {
    return { status: "start-failed" as const, stdout: "", stderr: "Trusted command runner returned an invalid response", exitCode: 125, elapsedMs: response.exec_ms };
  }
}

export async function startGuardedProcess(sandbox: SandboxHandle, input: { command: string; args?: string[]; cwd: string; signal?: AbortSignal }) {
  const args = input.args ?? [];
  const totalBytes = [input.command, ...args].reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0);
  if (args.length > 256 || totalBytes > 16 * 1024 || [input.command, ...args].some((value) => value.includes("\0"))) throw new Error("Process argument budget exceeded");
  if (!isWorkspaceDirectory(input.cwd)) throw new Error("Process working directory is outside the workspace");
  const response = await sandbox.runCommand("python3", ["/opt/gentx2/command-runner.py", "--timeout", "180", "--cwd", input.cwd, "--detach", "--", input.command, ...args], { timeoutMs: 10_000, retry: false, signal: input.signal });
  const result = GuardedCommandResultSchema.parse(JSON.parse(response.result.stdout));
  if (result.status !== "spawned" || !result.pid || !Number.isSafeInteger(result.pid)) throw new Error("CreateOS target process did not start");
  return { pid: result.pid, elapsedMs: result.elapsedMs };
}

export async function stopGuardedProcess(sandbox: SandboxHandle, processGroupId: number) {
  if (!Number.isSafeInteger(processGroupId) || processGroupId < 2) return;
  const script = `import os,signal\npid=${processGroupId}\ntry: os.killpg(pid,signal.SIGTERM)\nexcept ProcessLookupError: pass\n`;
  await sandbox.runCommand("python3", ["-c", script], { timeoutMs: 10_000, retry: false }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const killScript = `import os,signal\npid=${processGroupId}\ntry: os.killpg(pid,signal.SIGKILL)\nexcept ProcessLookupError: pass\n`;
  await sandbox.runCommand("python3", ["-c", killScript], { timeoutMs: 10_000, retry: false }).catch(() => undefined);
}
