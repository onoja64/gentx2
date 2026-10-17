import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
}

export interface AppendEventInput {
  projectId: string;
  scanId?: string | null;
  targetId?: string | null;
  actor: "user" | "blackhat" | "whitehat" | "sentinel" | "auditor" | "orchestrator" | "system";
  type: string;
  payload: Record<string, unknown>;
}

export async function appendAuditEvent(input: AppendEventInput) {
  const payloadText = JSON.stringify(input.payload);
  if (!payloadText || Buffer.byteLength(payloadText, "utf8") > 64 * 1024 || !/^[A-Z][A-Z0-9_]{1,63}$/.test(input.type)) throw new Error("Audit event does not match the bounded immutable event contract");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("gentx2_append_audit_event", {
    p_project_id: input.projectId, p_scan_id: input.scanId ?? null, p_target_id: input.targetId ?? null,
    p_actor: input.actor, p_type: input.type, p_payload: input.payload,
  });
  if (error || !data) throw new Error(`Immutable audit append failed${error?.code ? ` (${error.code})` : ""}`);
  return data;
}

export interface StoredEvent {
  event_id: number; project_id: string; sequence: number; scan_id: string | null; target_id: string | null;
  actor: string; type: string; payload: Record<string, unknown> | string; created_at: string;
  previous_hash: string | null; event_hash: string;
}

export async function listSessionEvents(client: SupabaseClient, scanId: string, afterSequence = 0, limit = 100): Promise<StoredEvent[]> {
  const safeAfter = Math.max(0, Math.floor(afterSequence));
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const { data, error } = await client.from("audit_events").select("event_id,project_id,sequence,scan_id,target_id,actor,type,payload,created_at,previous_hash,event_hash").eq("scan_id", scanId).gt("sequence", safeAfter).order("sequence", { ascending: true }).limit(safeLimit);
  if (error) throw new Error("Persistent event history is unavailable");
  return (data ?? []) as StoredEvent[];
}

export function verifyEventHash(event: StoredEvent) {
  const payload = typeof event.payload === "string" ? JSON.parse(event.payload) as Record<string, unknown> : event.payload;
  const unsigned = {
    sequence: Number(event.sequence), sessionId: event.scan_id, targetId: event.target_id, actor: event.actor, type: event.type,
    payload, createdAt: new Date(event.created_at).toISOString(), previousHash: event.previous_hash,
  };
  return createHash("sha256").update(canonical(unsigned)).digest("hex") === event.event_hash;
}
