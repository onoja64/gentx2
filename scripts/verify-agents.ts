import { agentProvider } from "../lib/agents/remote-provider";
import type { AgentRole } from "../lib/agents/provider";
import {
  AuditorOutputSchema,
  BlackHatOutputSchema,
  OrchestratorOutputSchema,
  SentinelOutputSchema,
  WhiteHatOutputSchema,
} from "../lib/agents/contracts";
import { z } from "zod";

let failed = false;

async function runProbe<T>(role: AgentRole, schema: z.ZodType<T>, accepts: (result: T) => boolean) {
  try {
    const response = await agentProvider.generateJson({
      role,
      purpose: "Connectivity and output-contract smoke check only. No target, diff, session, or evidence was supplied. Return an empty and inconclusive result; do not invent findings or actions.",
      untrustedData: "",
      maxOutputTokens: 128,
    }, schema);
    if (accepts(response.result)) {
      console.log(`AGENT_${role.toUpperCase()}=pass schema=valid abstention=valid model=${response.model}`);
    } else {
      failed = true;
      console.error(`AGENT_${role.toUpperCase()}=fail reason=unexpected_result`);
    }
  } catch (error) {
    failed = true;
    const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
    const code = typeof record.code === "string" && /^[A-Z0-9_-]{1,40}$/.test(record.code) ? record.code : "UNKNOWN";
    const message = error instanceof Error ? error.message.replace(/[^\x20-\x7e]/g, " ").slice(0, 160) : "Agent request failed";
    console.error(`AGENT_${role.toUpperCase()}=fail code=${code} message=${message}`);
  }
}

const probes = [
  () => runProbe("blackhat", BlackHatOutputSchema, (result) => result.inconclusive && result.observations.length === 0),
  () => runProbe("whitehat", WhiteHatOutputSchema, (result) => result.requiresHumanApproval && result.proposals.length === 0),
  () => runProbe("sentinel", SentinelOutputSchema, (result) => result.verdict === "inconclusive" && result.findingIds.length === 0 && result.evidenceIds.length === 0),
  () => runProbe("auditor", AuditorOutputSchema, (result) => result.verdict === "inconclusive" && result.checks.length === 0),
  () => runProbe("orchestrator", OrchestratorOutputSchema, (result) => result.recommendation === "inconclusive"),
];

for (let i = 0; i < probes.length; i++) {
  await probes[i]();
  if (i < probes.length - 1) await new Promise((resolve) => setTimeout(resolve, 1_500));
}

if (failed) process.exitCode = 1;
