import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

// Load the repo-root .env for local dev. In production (Railway) the env is
// injected directly, and dotenv is a no-op when the file is absent.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../../.env") });

// Fail fast on boot if required config is missing.
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(8080),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // OneInbox shares a Supabase project with ibookshelf for now; all of its
  // tables live in this schema. The schema must be listed under the project's
  // Settings -> API -> Exposed schemas or every query 404s.
  SUPABASE_DB_SCHEMA: z.string().default("uni_inbox"),

  // 32-byte base64 key for AES-256-GCM encryption of mail passwords at rest.
  // Generate: openssl rand -base64 32. Rotating it requires users to re-enter
  // credentials (blobs are versioned v1: to allow a future re-encrypt path).
  CREDENTIALS_KEY: z
    .string()
    .refine((s) => Buffer.from(s, "base64").length === 32, {
      message: "CREDENTIALS_KEY must be 32 bytes of base64 (openssl rand -base64 32)",
    }),

  // Stripe billing. All optional so the app boots without billing configured
  // (checkout/webhook endpoints then return a clear error instead). Local dev
  // holds the TEST key; Railway holds the LIVE key + live price ids.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_LIFETIME: z.string().optional(),

  // Comma-separated allowed dashboard origins (e.g. the Vercel URL). When
  // unset, all origins are allowed (requests still require a valid JWT).
  CORS_ORIGINS: z.string().optional(),

  // Absolute dashboard URL used in checkout redirects.
  DASHBOARD_URL: z.string().url().default("http://localhost:5173"),

  // Sync tuning. Retention keeps the storage bill flat: we are a recent-mail
  // window, not an archive. It only ever deletes OneInbox's own copy; nothing
  // here touches the user's mailbox on the mail server.
  MAIL_RETENTION_DAYS: z.coerce.number().default(365),
  // Also the scroll-back ceiling: backfill stops once an account holds this
  // many messages, so the two limits can never fight each other.
  MAIL_RETENTION_MAX_PER_ACCOUNT: z.coerce.number().default(1000),
  INITIAL_SYNC_LIMIT: z.coerce.number().default(200),
  // How many older messages one "load older mail" request pulls.
  BACKFILL_BATCH: z.coerce.number().default(200),

  // Per-user daily outbound send cap (protects against runaway clients).
  SEND_DAILY_CAP: z.coerce.number().default(50),

  // Outbox kill switch: "1" queues every send through the worker (which is
  // what Undo Send and Send Later ride on); anything else reverts to the
  // proven synchronous send path without a deploy. Compared against "1" for
  // the same Boolean("0")-is-true reason as below.
  OUTBOX_ENABLED: z.string().default("1"),
  // Undo window: how long a send sits in the outbox before the worker may
  // pick it up.
  OUTBOX_UNDO_SECONDS: z.coerce.number().default(10),

  // Sent-mailbox sync kill switch. Compared against "1", never coerced to
  // boolean: Boolean("0") and Boolean("false") are both true, so a coerced
  // flag could never be switched off.
  SENT_SYNC_ENABLED: z.string().default("1"),
  // The first pass over a Sent folder only reaches back this many messages.
  // Sent volume is the user's own output, so this covers months for a solo
  // founder while keeping the first Sent cycle inside the 120s cycle deadline.
  SENT_INITIAL_SYNC_LIMIT: z.coerce.number().default(100),

  // AI thread summaries (paid add-on). Optional: without the key the AI
  // endpoints return 503 and everything else runs normally.
  ANTHROPIC_API_KEY: z.string().optional(),
  // Haiku, deliberately: a 2-3 sentence thread summary is a Haiku-class task,
  // and the $3/month add-on price only carries a margin at Haiku's rates
  // (~0.25 cents per summary vs ~1.25 on Opus, which would LOSE money at the
  // daily cap). Swap models here, not in code.
  AI_SUMMARY_MODEL: z.string().default("claude-haiku-4-5"),
  // Per-user per-day summary cap. Bounds a runaway client's spend; a capped
  // day costs about 6 cents. Not a marketed limit.
  AI_DAILY_CAP: z.coerce.number().default(25),
  // Manual override for the add-on price id; normally resolved by lookup key.
  STRIPE_PRICE_AI: z.string().optional(),

  // OAuth mail providers. Optional: without them the connect modal falls
  // back to app-password flows for those providers.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),

  // Founder dashboard (/users) second gate on top of the owner-email check.
  // Override in Railway to rotate.
  ADMIN_PASSWORD: z.string().default("123456789"),

  // Marketing-site contact form. Optional: without the key the endpoint
  // returns 503 instead of blocking boot.
  RESEND_API_KEY: z.string().optional(),
  CONTACT_TO_EMAIL: z.string().email().default("rossdelport1998@gmail.com"),
  // Sender must be on a Resend-verified domain (trynoisy.com is verified).
  CONTACT_FROM_EMAIL: z.string().default("OneInbox contact form <oneinbox@trynoisy.com>"),
});

// Blank is the same as absent.
//
// Railway, like most hosts, injects a variable that was left empty as an
// empty string rather than omitting it, and zod's .default() / .optional()
// only fire on undefined. So NODE_ENV="" failed the enum and killed the
// process on boot. That is why deploys intermittently lost the healthcheck
// race: under restartPolicy ALWAYS the container crash-looped, and a deploy
// passed or failed depending on whether an attempt happened to answer
// /health before dying again.
//
// PORT is the quieter twin of the same bug: "" coerces to 0, which passes
// validation and makes the server listen on a random free port. Nothing logs
// an error, the healthcheck simply never connects.
const provided = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
);

export const env = schema.parse(provided);
export type Env = z.infer<typeof schema>;
