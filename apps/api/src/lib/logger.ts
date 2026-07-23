import pino from "pino";
import { env } from "../config/env.js";

// Redaction is load-bearing here: this process handles users' real mail
// passwords in memory. Anything credential-shaped is stripped before a log
// line is written, so a leaked log can never leak a mailbox.
export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "*.password",
      "*.*.password",
      "auth",
      "*.auth",
      "credentials",
      "*.credentials",
      "imap_password",
      "smtp_password",
      "*.imap_password",
      "*.smtp_password",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
