import { logger } from "./logger.js";

// Last-resort process guards. The API and every user's IMAP sync loop share
// one process, so a single stray rejection must not take the whole service
// down. Uncaught exceptions still exit (program state is unknowable) but now
// leave the reason in the logs before Railway restarts us.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception, exiting");
  process.exitCode = 1;
  // Brief grace so the log line flushes before the exit.
  setTimeout(() => process.exit(1), 300).unref();
});
