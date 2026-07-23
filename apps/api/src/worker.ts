import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { superviseTick } from "./services/imapSync.js";
import { retentionSweep } from "./services/retention.js";

// IMAP sync supervisor. Every 30s: start syncers for due accounts, tear down
// ones that were removed/paused. Each syncer holds a live IDLE connection, so
// new mail lands in seconds; the tick only handles lifecycle.
logger.info("sync supervisor starting");

const SUPERVISOR_INTERVAL_MS = 30_000;
let ticking = false;

setInterval(() => {
  if (ticking) return; // never overlap ticks
  ticking = true;
  superviseTick()
    .catch((err) => logger.error({ err }, "supervisor tick failed"))
    .finally(() => {
      ticking = false;
    });
}, SUPERVISOR_INTERVAL_MS);
void superviseTick().catch((err) => logger.error({ err }, "initial supervisor tick failed"));

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
