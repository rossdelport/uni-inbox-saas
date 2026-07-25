// Liveness signal for the IMAP sync supervisor.
//
// The API and the worker share a process (main.ts imports both), so /health
// can read this directly. It exists because a dead worker is invisible from
// the outside: the site keeps serving, the dashboard keeps loading, and mail
// silently stops arriving. Uptime monitoring needs something to fail on.
//
// workerStartedAt stays null when the process runs API-only (SERVICE_ROLE=api),
// which is how /health knows not to expect ticks at all.
export const heartbeat = {
  workerStartedAt: null as number | null,
  lastTickAt: null as number | null,
};

export function markWorkerStarted(): void {
  heartbeat.workerStartedAt = Date.now();
}

/** Called after every supervisor tick, successful or not: this measures that
 *  the loop is still turning, not that every mailbox is healthy. */
export function markTick(): void {
  heartbeat.lastTickAt = Date.now();
}
