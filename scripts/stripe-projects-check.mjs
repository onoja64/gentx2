import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.some((value) => ["init", "add", "upgrade", "env", "pay"].includes(value))) {
  console.error("Refusing mutating Stripe Projects command. Use the approved workflow manually after reviewing plan and spend.");
  process.exit(2);
}
const localCli = fileURLToPath(new URL("../.tools/stripe-cli/node_modules/.bin/stripe", import.meta.url));
const localConfig = fileURLToPath(new URL("../.tools/stripe-cli/config", import.meta.url));
const useLocalCli = !process.env.STRIPE_CLI_PATH && existsSync(localCli);
const cli = process.env.STRIPE_CLI_PATH || (useLocalCli ? localCli : "stripe");
const env = useLocalCli ? { ...process.env, XDG_CONFIG_HOME: localConfig } : process.env;
const child = spawn(cli, ["projects", "--help", ...args], { stdio: ["ignore", "pipe", "pipe"], env });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
child.on("error", () => {
  console.error("Stripe CLI is not installed or could not be started. Install it, then install/verify the Projects plugin before provisioning.");
  process.exit(1);
});
child.on("exit", (code) => {
  if (code === 0) {
    console.log(output.trim());
    console.log("Read-only check passed. No project, provider, credential, plan, or payment mutation was attempted.");
  } else {
    console.error(output.trim() || `stripe projects --help exited with ${code}`);
    process.exit(code ?? 1);
  }
});
