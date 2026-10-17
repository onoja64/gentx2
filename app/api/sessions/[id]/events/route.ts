import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/db/repository";
import { listSessionEvents, verifyEventHash } from "@/lib/events/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid scan ID" }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try { if (!await getSession(supabase, id)) return NextResponse.json({ error: "Scan not found" }, { status: 404 }); }
  catch { return NextResponse.json({ error: "Persistent event history is unavailable" }, { status: 503 }); }
  const url = new URL(request.url);
  const query = Number(url.searchParams.get("after") || 0);
  const header = Number(request.headers.get("last-event-id") || 0);
  let sequence = Math.max(0, Number.isSafeInteger(header) && header > 0 ? header : Number.isSafeInteger(query) ? query : 0);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now(); let lastHeartbeat = 0;
      try {
        controller.enqueue(encoder.encode("retry: 2000\n\n"));
        while (!request.signal.aborted && Date.now() - started < 20_000) {
          const events = await listSessionEvents(supabase, id, sequence, 100);
          for (const event of events) {
            if (!verifyEventHash(event)) {
              controller.enqueue(encoder.encode(`event: integrity_error\ndata: ${JSON.stringify({ sequence: event.sequence, message: "Audit hash mismatch; stream halted" })}\n\n`)); controller.close(); return;
            }
            sequence = Number(event.sequence);
            const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
            const frame = { id: String(sequence), sequence, actor: event.actor, type: event.type, createdAt: event.created_at, payload };
            controller.enqueue(encoder.encode(`id: ${sequence}\nevent: message\ndata: ${JSON.stringify(frame)}\n\n`));
          }
          if (Date.now() - lastHeartbeat > 5000) { controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`)); lastHeartbeat = Date.now(); }
          await sleep(800);
        }
      } catch {
        if (!request.signal.aborted) { try { controller.enqueue(encoder.encode(`event: stream_error\ndata: ${JSON.stringify({ message: "Persistent event stream temporarily unavailable" })}\n\n`)); } catch { /* already closed */ } }
      } finally { try { controller.close(); } catch { /* already closed */ } }
    },
    cancel() { /* request abort ends polling */ },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
