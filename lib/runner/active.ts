const globalForRuns = globalThis as typeof globalThis & { gentx2ActiveRuns?: Map<string, AbortController> };
const activeRuns = globalForRuns.gentx2ActiveRuns ??= new Map<string, AbortController>();

export function registerSessionRun(sessionId: string, controller: AbortController) {
  activeRuns.set(sessionId, controller);
}

export function abortSessionRun(sessionId: string) {
  const controller = activeRuns.get(sessionId);
  if (controller && !controller.signal.aborted) controller.abort(new Error("Operator requested stop"));
}

export function unregisterSessionRun(sessionId: string, controller: AbortController) {
  if (activeRuns.get(sessionId) === controller) activeRuns.delete(sessionId);
}
