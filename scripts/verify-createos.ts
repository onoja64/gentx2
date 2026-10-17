import { createClient } from "@nodeops-createos/sandbox";

const client = createClient({ timeoutMs: 20_000, retry: false });
const sandboxName = `g2-smk-${Date.now().toString(36)}`;
let sandbox: Awaited<ReturnType<typeof client.createSandbox>> | undefined;
let stage = "authentication";
let failed = false;

try {
  await client.whoami();
  stage = "sandbox-create";
  sandbox = await client.createSandbox(
    {
      name: sandboxName,
      shape: "s-1vcpu-1gb",
      rootfs: "devbox:1",
      egress: ["example.com:443"],
      auto_pause_after_seconds: 60,
    },
    { timeoutMs: 90_000, retry: false },
  );

  stage = "egress-readback";
  const policy = await sandbox.getEgress({ timeoutMs: 10_000, retry: false });
  if (policy.egress.length !== 1 || policy.egress[0] !== "example.com:443") {
    throw new Error("egress policy mismatch");
  }

  stage = "bounded-command";
  const result = await sandbox.runCommand(
    "timeout",
    ["5s", "uname", "-s"],
    { timeoutMs: 10_000, retry: false },
  );
  if (result.result.exit_code !== 0 || result.result.stdout.trim() !== "Linux") {
    throw new Error("command result mismatch");
  }

  console.log("CREATEOS_AUTH=verified");
  console.log("CREATEOS_SANDBOX=created_and_running");
  console.log("CREATEOS_EGRESS=explicit_allowlist_verified");
  console.log("CREATEOS_COMMAND=bounded_uname_passed");
} catch (error) {
  failed = true;
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const status = Number.isInteger(record.statusCode) ? String(record.statusCode) : "none";
  const code = typeof record.code === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(record.code) ? record.code : "none";
  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error(`CREATEOS_SMOKE=failed stage=${stage} name=${errorName} status=${status} code=${code}`);
  const envelope = typeof record.envelope === "object" && record.envelope !== null
    ? record.envelope as Record<string, unknown>
    : {};
  const data = envelope.data;
  const fields = typeof data === "object" && data !== null && !Array.isArray(data)
    ? Object.keys(data).filter((key) => /^[A-Za-z0-9_.-]{1,80}$/.test(key)).slice(0, 12).join(",")
    : "none";
  const detail = typeof data === "string"
    ? data.slice(0, 240).replace(/[\u0000-\u001f\u007f]/g, " ")
    : "";
  if (fields !== "none") console.error(`CREATEOS_VALIDATION_FIELDS=${fields}`);
  if (detail) console.error(`CREATEOS_VALIDATION_DETAIL=${detail}`);
} finally {
  if (sandbox) {
    stage = "cleanup";
    try {
      await sandbox.destroy({ timeoutMs: 15_000, retry: false });
      await sandbox.waitUntilDestroyed({
        timeoutMs: 90_000,
        request: { timeoutMs: 15_000, retry: false },
      });
      console.log("CREATEOS_CLEANUP=destroyed");
    } catch (error) {
      failed = true;
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error(`CREATEOS_CLEANUP=failed (${errorName})`);
    }
  }
}

const exitCode = failed ? 1 : 0;
await Promise.all([
  new Promise<void>((resolve) => process.stdout.write("", () => resolve())),
  new Promise<void>((resolve) => process.stderr.write("", () => resolve())),
]);
// The SDK's shared HTTP pool can keep Node alive after the sandbox has been
// destroyed. All work and cleanup are awaited above, so exit with the result.
process.exit(exitCode);
