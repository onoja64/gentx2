import type { z } from "zod";

export type AgentRole = "blackhat" | "whitehat" | "sentinel" | "auditor" | "orchestrator";

export interface AgentRequest {
  role: AgentRole;
  purpose: string;
  untrustedData: string;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  maxInputCharacters?: number;
}

export interface AgentResponse<T> {
  result: T;
  provider: "remote-model-api";
  model: string;
  usage: { inputTokens?: number; outputTokens?: number; costUsd: null };
}

export interface AgentProvider {
  generateJson<T>(request: AgentRequest, schema: z.ZodType<T>): Promise<AgentResponse<T>>;
}

export class AgentProviderError extends Error {
  constructor(message: string, readonly code: "CONFIGURATION" | "TIMEOUT" | "HTTP" | "RESPONSE" | "SCHEMA" = "RESPONSE") {
    super(message);
    this.name = "AgentProviderError";
  }
}
