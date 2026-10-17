"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle, Clock3, Radio } from "lucide-react";
import { Card } from "@/components/ui/card";

export interface SessionEvent {
  id: string;
  sequence: number;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export function LiveEvents({ sessionId, onEvent }: { sessionId?: string | null; onEvent?: (event: SessionEvent) => void }) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [streamState, setStreamState] = useState<"idle" | "connecting" | "live" | "error">("idle");
  useEffect(() => {
    setEvents([]);
    if (!sessionId) { setStreamState("idle"); return; }
    setStreamState("connecting");
    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
    source.onopen = () => setStreamState("live");
    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data) as SessionEvent;
        if (!parsed || typeof parsed.id !== "string" || !Number.isInteger(parsed.sequence)) return;
        setEvents((current) => current.some((item) => item.id === parsed.id) ? current : [...current, parsed].slice(-100));
        onEvent?.(parsed);
      } catch { /* malformed stream frames are ignored; the stored audit ledger remains authoritative */ }
    };
    source.onerror = () => setStreamState("error");
    return () => source.close();
  }, [sessionId, onEvent]);

  const statusLabel = streamState === "live" ? "LIVE" : streamState === "connecting" ? "CONNECTING" : streamState === "error" ? "RECONNECTING" : "IDLE";
  return (
    <Card className="terminal-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/65 px-4 py-3">
        <div className="flex items-center gap-2"><Activity className="size-3.5 text-[var(--terminal-green)]" /><h2 className="mono text-[10px] font-semibold">LIVE SECURITY LOG</h2><span className="mono text-[8px] text-muted-foreground">AUDIT-LINKED</span></div>
        <span className="flex items-center gap-1.5 mono text-[8px] text-muted-foreground"><span className={`size-1.5 rounded-full ${streamState === "live" ? "signal-live bg-[var(--terminal-green)]" : streamState === "error" ? "bg-amber-300" : "bg-muted-foreground/40"}`} />{statusLabel}</span>
      </div>
      <div className="max-h-[310px] min-h-[168px] overflow-y-auto p-2.5">
        {events.length === 0 ? (
          <div className="grid min-h-[148px] place-items-center rounded-md border border-dashed border-border/65 bg-black/20 px-5 text-center">
            <div><Radio className="mx-auto mb-2 size-4 text-muted-foreground/60" /><p className="mono text-[9px] text-muted-foreground">{sessionId ? "AWAITING PERSISTED EVENTS" : "NO ACTIVE SESSION"}</p><p className="mt-1 text-[8px] text-muted-foreground/65">No mock activity is shown as evidence.</p></div>
          </div>
        ) : (
          <ol className="space-y-1">
            {events.slice().reverse().map((event) => (
              <li key={event.id} className="grid grid-cols-[58px_1fr] gap-2 rounded px-2 py-2 hover:bg-white/[0.025]">
                <time className="mono pt-0.5 text-[8px] text-muted-foreground/65">{new Date(event.createdAt).toLocaleTimeString([], { hour12: false })}</time>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="size-1.5 rounded-full bg-[var(--terminal-green)]/80" /><span className="mono text-[8px] text-[var(--aqua)]">#{String(event.sequence).padStart(3, "0")}</span><span className="mono text-[8px] text-[var(--terminal-green)]">{event.type}</span></div><p className="mt-1 line-clamp-3 break-words mono text-[8px] leading-relaxed text-foreground/70">{typeof event.payload.message === "string" ? event.payload.message : "Persisted audit event"}</p></div>
              </li>
            ))}
          </ol>
        )}
        {streamState === "error" && <div className="mt-2 flex items-center gap-2 px-2 text-[8px] text-amber-200"><AlertCircle className="size-3" />Reconnecting. Stored audit history remains authoritative.</div>}
        {!sessionId && <div className="mt-2 flex items-center gap-1.5 px-2 text-[8px] text-muted-foreground/60"><Clock3 className="size-3" />Awaiting a session ID</div>}
      </div>
    </Card>
  );
}
