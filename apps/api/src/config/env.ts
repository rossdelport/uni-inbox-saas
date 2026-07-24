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

  // Sync tuning. Retention keeps the storage bill flat: we are an inbox
  // window, not an archive.
  MAIL_RETENTION_DAYS: z.coerce.number().default(90),
  MAIL_RETENTION_MAX_PER_ACCOUNT: z.coerce.number().default(500),
  INITIAL_SYNC_LIMIT: z.coerce.number().default(200),

  // Per-user daily outbound send cap (protects against runaway clients).
  SEND_DAILY_CAP: z.coerce.number().default(50),

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

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
