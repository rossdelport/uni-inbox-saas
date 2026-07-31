import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { resolveThread } from "./threading.js";
import { appendToSent, recordOutbound, smtpSend, type SendAccount } from "./smtpSend.js";
import { inputOf } from "./outbox.js";

// The outbox drain: claim due rows, deliver them, settle their status. Runs
// in the worker every few seconds.
//
// The one rule that outranks everything here: NEVER deliver the same row
// twice. A duplicate email cannot be recalled. So a row that fails in any
// way we cannot classify as before-the-wire lands in a terminal state
// (failed/unknown) and is left for a human; only connection-establishment
// errors, where no SMTP conversation happened at all, requeue.

const CLAIM_BATCH = 5;
const MAX_TRANSIENT_ATTEMPTS = 3;
const UNKNOWN_AFTER_MS = 5 * 60_000;

const ACCOUNT_COLUMNS =
  "id, owner_id, email_address, smtp_host, smtp_port, smtp_security, imap_host, imap_port, imap_username, credentials_enc, provider_preset, auth_method, status";

/** True only for errors raised while ESTABLISHING the connection, before any
 *  SMTP command was sent: nothing can have been delivered. nodemailer tags
 *  post-connect failures with responseCode, which disqualifies them. */
function isPreConnectError(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number };
  if (e?.responseCode) return false;
  return ["ECONNECTION", "ESOCKET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "EDNS"].includes(
    e?.code ?? "",
  );
}

export async function outboxDrain(): Promise<void> {
  const nowIso = new Date().toISOString();

  // A row stuck in "sending" past the TTL means the worker died mid-delivery.
  // The bytes may or may not have left; the only honest state is unknown, and
  // it must never be requeued.
  const staleBefore = new Date(Date.now() - UNKNOWN_AFTER_MS).toISOString();
  const { data: orphaned } = await supabase
    .from("outbox")
    .update({
      status: "unknown",
      last_error:
        "The send was interrupted and we could not confirm whether it was delivered. Check the Sent folder before sending again.",
      updated_at: nowIso,
    })
    .eq("status", "sending")
    .lt("claimed_at", staleBefore)
    .select("id");
  if ((orphaned ?? []).length > 0) {
    logger.warn({ rows: orphaned!.length }, "outbox rows orphaned mid-send marked unknown");
  }

  const { data: due } = await supabase
    .from("outbox")
    .select("id")
    .eq("status", "queued")
    .lte("not_before", nowIso)
    .order("not_before", { ascending: true })
    .limit(CLAIM_BATCH);
  if (!due || due.length === 0) return;

  // The .eq("status","queued") on the UPDATE is the claim: a row cancelled
  // between the select and here simply does not come back.
  const { data: claimed } = await supabase
    .from("outbox")
    .update({ status: "sending", claimed_at: nowIso, updated_at: nowIso })
    .in("id", due.map((r) => r.id as string))
    .eq("status", "queued")
    .select("*");

  for (const row of claimed ?? []) {
    await deliver(row as Record<string, unknown>);
  }
}

async function deliver(row: Record<string, unknown>): Promise<void> {
  const id = row.id as string;
  const { data: account } = await supabase
    .from("email_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", row.account_id as string)
    .maybeSingle();

  if (!account || account.status !== "active") {
    await settle(id, {
      status: "failed",
      last_error: "This inbox is paused, so the message was not sent. Reconnect it and send again.",
    });
    return;
  }

  const input = inputOf(row.payload as Record<string, unknown>, row.attachments);
  try {
    const sent = await smtpSend(account as SendAccount, input, row.message_rfc_id as string);

    let threadId = (row.thread_id as string | null) ?? null;
    if (!threadId) {
      threadId = await resolveThread({
        ownerId: row.owner_id as string,
        accountId: account.id as string,
        messageId: sent.messageId,
        inReplyTo: null,
        referencesIds: [],
        subject: input.subject,
        fromAddress: (account.email_address as string).toLowerCase(),
        toAddresses: input.to.map((a) => a.toLowerCase()),
        date: new Date(),
        snippet: input.bodyText.replace(/\s+/g, " ").trim().slice(0, 140) || null,
        seen: true,
        direction: "outbound",
      });
    }
    await recordOutbound(account as SendAccount, threadId, input, sent.messageId);
    void appendToSent(account as SendAccount, sent.raw);

    // Success nulls the attachment bytes: at the daily cap with 15 MB
    // attachments they would otherwise pile up ~GBs/week of dead rows.
    await settle(id, {
      status: "sent",
      sent_at: new Date().toISOString(),
      attachments: null,
      thread_id: threadId,
      last_error: null,
    });
  } catch (err) {
    const attempts = Number(row.attempts ?? 0) + 1;
    if (isPreConnectError(err) && attempts < MAX_TRANSIENT_ATTEMPTS) {
      logger.warn({ err, outboxId: id, attempts }, "outbox send connection failed; requeued");
      await settle(id, {
        status: "queued",
        attempts,
        claimed_at: null,
        not_before: new Date(Date.now() + attempts * 30_000).toISOString(),
        last_error: null,
      });
      return;
    }
    logger.error({ err, outboxId: id }, "outbox send failed");
    await settle(id, {
      status: "failed",
      attempts,
      last_error: "The mail server rejected the send. Open the conversation to try again.",
    });
  }
}

async function settle(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("outbox")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) logger.error({ err: error, outboxId: id }, "outbox settle failed");
}
