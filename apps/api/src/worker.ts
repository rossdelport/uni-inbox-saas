import "./lib/failsafe.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { superviseTick } from "./services/imapSync.js";
import { retentionSweep } from "./services/retention.js";
import { markTick, markWorkerStarted } from "./lib/heartbeat.js";

// IMAP sync supervisor. Every 30s: start syncers for due accounts, tear down
// ones that were removed/paused. Each syncer holds a live IDLE connection, so
// new mail lands in seconds; the tick only handles lifecycle.
logger.info("sync supervisor starting");
markWorkerStarted();

// Deploy-restart recovery. While a connection is healthy its account carries
// a far-future next_sync_at so the supervisor leaves it alone; when a deploy
// kills the process, the connections die but those placeholders survive, and
// every mailbox sits dead until its placeholder expires, up to 30 minutes.
// With a dozen-plus deploys in a day, that WAS the product's mail latency.
// On boot no syncer exists, so any far-future stamp is a lie: clamp anything
// beyond the maximum failure backoff (5 min) down to now. Real backoffs sit
// inside that window and stay respected.
void import("./lib/supabase.js")
  .then(({ supabase }) =>
    supabase
      .from("email_accounts")
      .update({ next_sync_at: new Date().toISOString() })
      .eq("status", "active")
      .gt("next_sync_at", new Date(Date.now() + 6 * 60_000).toISOString()),
  )
  .then(({ error }) => {
    if (error) throw error;
    logger.info("boot: stale sync placeholders clamped");
  })
  .catch((err) => logger.error({ err }, "boot placeholder clamp failed"));

const SUPERVISOR_INTERVAL_MS = 30_000;
let ticking = false;

setInterval(() => {
  if (ticking) return; // never overlap ticks
  ticking = true;
  superviseTick()
    .catch((err) => logger.error({ err }, "supervisor tick failed"))
    .finally(() => {
      ticking = false;
      markTick();
    });
}, SUPERVISOR_INTERVAL_MS);
void superviseTick()
  .catch((err) => logger.error({ err }, "initial supervisor tick failed"))
  .finally(() => markTick());

// Retention sweep: daily, first pass 5 minutes after boot (not at boot, so a
// crash-loop never hammers deletes).
setTimeout(() => {
  const run = () =>
    retentionSweep().catch((err) => logger.error({ err }, "retention sweep failed"));
  void run();
  setInterval(run, 24 * 3600 * 1000);
}, 5 * 60_000);

logger.info(
  {
    retentionDays: env.MAIL_RETENTION_DAYS,
    maxPerAccount: env.MAIL_RETENTION_MAX_PER_ACCOUNT,
  },
  "worker configured",
);
