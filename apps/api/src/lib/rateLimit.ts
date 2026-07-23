// Small in-memory per-user rate limiter for hot endpoints (connection tests).
// Single-process deployment makes in-memory fine; the send cap uses a
// Postgres counter instead because it must survive restarts.
const buckets = new Map<string, number[]>();

export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
