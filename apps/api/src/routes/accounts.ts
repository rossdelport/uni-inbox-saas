import { Router } from "express";
import { z } from "zod";
import nodemailer from "nodemailer";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { allow } from "../lib/rateLimit.js";
import { encryptCredentials } from "../lib/crypto.js";
import { getBilling } from "../lib/plans.js";
import { buildImap } from "../services/imapClient.js";
import { PRESETS } from "../services/providerPresets.js";
import { wakeAccount } from "../services/imapSync.js";

export const accountsRouter = Router();

// Per-account color badges. Assigned round-robin at connect time.
const PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#a855f7", "#14b8a6", "#f97316", "#84cc16", "#ec4899",
  "#64748b", "#eab308",
];

// No zod .default()s here on purpose: the connect form always sends every
// field, and defaults make the inferred input type all-optional, which breaks
// the TestInput assignability under some compiler configurations.
const accountInput = z.object({
  label: z.string().min(1).max(80),
  email_address: z.string().email().transform((s) => s.toLowerCase()),
  provider_preset: z.enum(["gmail", "icloud", "porkbun", "custom"]),
  imap_host: z.string().min(1).max(255),
  imap_port: z.coerce.number().int().min(1).max(65535),
  smtp_host: z.string().min(1).max(255),
  smtp_port: z.coerce.number().int().min(1).max(65535),
  smtp_security: z.enum(["tls", "starttls"]),
  imap_username: z.string().min(1).max(255),
  password: z
    .string()
    .min(1)
    .max(1024)
    .transform((s) => (/^[a-z]{4}( [a-z]{4}){3}$/i.test(s.trim()) ? s.replace(/\s+/g, "") : s)),
});

const SANITIZED_COLUMNS =
  "id, label, email_address, color, provider_preset, status, last_error, created_at";

// Derived from the schema so route parse results are assignable by
// construction, independent of how zod's inference behaves on any compiler.
type TestInput = z.infer<typeof accountInput>;

/** Live IMAP login + SMTP verify with tight timeouts. Errors are scrubbed:
 *  never echo anything that could contain the password. */
async function testConnection(input: TestInput): Promise<{ imap_ok: boolean; smtp_ok: boolean; error: string | null }> {
  let imapOk = false;
  let smtpOk = false;
  let error: string | null = null;

  const imap = buildImap(
    {
      id: "test",
      imap_host: input.imap_host,
      imap_port: input.imap_port,
      imap_username: input.imap_username,
      credentials_enc: "",
      provider_preset: "custom",
    },
    input.password,
  );
  try {
    await imap.connect();
    imapOk = true;
    await imap.logout().catch(() => imap.close());
  } catch (err) {
    logger.warn(
      { host: input.imap_host, reason: err instanceof Error ? err.message : String(err) },
      "imap test failed",
    );
    error = scrub(err, "IMAP");
  }

  const transport = nodemailer.createTransport({
    host: input.smtp_host,
    port: input.smtp_port,
    secure: input.smtp_security === "tls",
    requireTLS: input.smtp_security === "starttls",
    auth: { user: input.imap_username, pass: input.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    logger: false,
  });
  try {
    await transport.verify();
    smtpOk = true;
  } catch (err) {
    logger.warn(
      { host: input.smtp_host, reason: err instanceof Error ? err.message : String(err) },
      "smtp test failed",
    );
    error = error ?? scrub(err, "SMTP");
  } finally {
    transport.close();
  }

  return { imap_ok: imapOk, smtp_ok: smtpOk, error };
}

function scrub(err: unknown, protocol: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = raw.toLowerCase();
  if (text.includes("web login") || text.includes("browser") || text.includes("application-specific")) {
    return `${protocol}: the provider wants an app password here, not your normal password.`;
  }
  if (text.includes("auth") || text.includes("credentials") || text.includes("password")) {
    return `${protocol} sign-in failed. Check the username and password.`;
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return `${protocol} server did not respond. Check the host and port.`;
  }
  if (text.includes("enotfound") || text.includes("getaddrinfo")) {
    return `${protocol} host not found. Check the server address.`;
  }
  if (text.includes("econnrefused")) {
    return `${protocol} connection refused. Check the port.`;
  }
  return `${protocol} connection failed.`;
}

// The onboarding UI reads presets from here so hosts live in one place.
accountsRouter.get("/presets", (_req, res) => {
  res.json(Object.values(PRESETS));
});

// Test a connection WITHOUT saving. Rate-limited: this endpoint takes
// arbitrary hosts + credentials, so it must not be a stuffing oracle.
accountsRouter.post("/test", async (req, res) => {
  if (!allow(`test:${userId(res)}`, 10, 3600_000)) {
    return res.status(429).json({ error: "Too many connection tests. Try again in an hour." });
  }
  const parsed = accountInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid input" });
  }
  res.json(await testConnection(parsed.data));
});

accountsRouter.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("email_accounts")
    .select(SANITIZED_COLUMNS)
    .eq("owner_id", userId(res))
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "could not load accounts" });
  res.json(data ?? []);
});

accountsRouter.post("/", async (req, res) => {
  const uid = userId(res);
  const parsed = accountInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid input" });
  }

  const billing = await getBilling(uid);
  if (billing.trialExpired) {
    return res.status(402).json({
      error: "Your trial has ended. Pick a plan to keep connecting inboxes.",
      code: "trial_expired",
    });
  }
  const { count } = await supabase
    .from("email_accounts")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", uid)
    .neq("status", "disabled");
  if ((count ?? 0) >= billing.plan.maxInboxes) {
    return res.status(402).json({
      error: `Your ${billing.plan.label} plan includes ${billing.plan.maxInboxes} inboxes. Upgrade to connect more.`,
      code: "inbox_cap",
    });
  }

  if (!allow(`test:${uid}`, 10, 3600_000)) {
    return res.status(429).json({ error: "Too many connection attempts. Try again in an hour." });
  }
  const test = await testConnection(parsed.data);
  // IMAP is the hard requirement (no mail without it). A failed SMTP check
  // still connects read-only: sync works now, sending starts working the
  // moment outbound SMTP reaches the provider (e.g. host unblocks the port).
  if (!test.imap_ok) {
    return res.status(422).json({ error: test.error ?? "connection test failed", test });
  }

  const { password, ...rest } = parsed.data;
  const { data: created, error } = await supabase
    .from("email_accounts")
    .insert({
      ...rest,
      owner_id: uid,
      color: PALETTE[(count ?? 0) % PALETTE.length],
      credentials_enc: encryptCredentials({ imap_password: password }),
      status: "active",
      next_sync_at: new Date().toISOString(),
    })
    .select(SANITIZED_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "That email address is already connected." });
    }
    logger.error({ error, uid }, "account insert failed");
    return res.status(500).json({ error: "could not save account" });
  }

  await supabase.from("sync_state").insert({ account_id: created.id });
  res.status(201).json(created);
});

const patchInput = z.object({
  label: z.string().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  password: z
    .string()
    .min(1)
    .max(1024)
    .transform((s) => (/^[a-z]{4}( [a-z]{4}){3}$/i.test(s.trim()) ? s.replace(/\s+/g, "") : s))
    .optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

accountsRouter.patch("/:id", async (req, res) => {
  const uid = userId(res);
  const parsed = patchInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid input" });
  }
  const { data: account } = await supabase
    .from("email_accounts")
    .select("id, status")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!account) return res.status(404).json({ error: "account not found" });

  const update: Record<string, unknown> = {};
  if (parsed.data.label) update.label = parsed.data.label;
  if (parsed.data.color) update.color = parsed.data.color;
  if (parsed.data.password) {
    // New password: re-encrypt, clear failure state, sync immediately.
    update.credentials_enc = encryptCredentials({ imap_password: parsed.data.password });
    update.status = "active";
    update.last_error = null;
    update.consecutive_failures = 0;
    update.next_sync_at = new Date().toISOString();
  }
  if (parsed.data.status === "disabled") update.status = "disabled";
  if (parsed.data.status === "active") {
    // Re-enabling counts against the plan cap.
    const billing = await getBilling(uid);
    const { count } = await supabase
      .from("email_accounts")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", uid)
      .neq("status", "disabled");
    if (account.status === "disabled" && (count ?? 0) >= billing.plan.maxInboxes) {
      return res.status(402).json({
        error: `Your ${billing.plan.label} plan includes ${billing.plan.maxInboxes} inboxes.`,
        code: "inbox_cap",
      });
    }
    update.status = "active";
    update.last_error = null;
    update.consecutive_failures = 0;
    update.next_sync_at = new Date().toISOString();
  }

  const { data: updated, error } = await supabase
    .from("email_accounts")
    .update(update)
    .eq("id", account.id)
    .select(SANITIZED_COLUMNS)
    .single();
  if (error) return res.status(500).json({ error: "could not update account" });
  res.json(updated);
});

accountsRouter.delete("/:id", async (req, res) => {
  const uid = userId(res);
  const { data: gone, error } = await supabase
    .from("email_accounts")
    .delete()
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .select("id");
  if (error) return res.status(500).json({ error: "could not remove account" });
  if (!gone || gone.length === 0) return res.status(404).json({ error: "account not found" });
  res.status(204).end();
});

// Manual "sync now" nudge from the dashboard.
accountsRouter.post("/:id/sync", async (req, res) => {
  const uid = userId(res);
  const { data: account } = await supabase
    .from("email_accounts")
    .select("id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!account) return res.status(404).json({ error: "account not found" });
  await wakeAccount(account.id);
  res.json({ ok: true });
});
