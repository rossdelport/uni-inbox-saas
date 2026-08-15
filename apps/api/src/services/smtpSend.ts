import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type SMTPPool from "nodemailer/lib/smtp-pool/index.js";
import { decryptCredentials } from "../lib/crypto.js";
import { getAccessToken, providerForAuthMethod } from "./oauthTokens.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { withActionImap, findSentMailbox } from "./imapClient.js";
import { touchThread } from "./threading.js";

// Outbound mail. The iron rule: a reply is ALWAYS sent from the account that
// owns the thread — resolved server-side, never client-supplied. That's the
// whole product promise (no more replying to a client from the wrong address).
//
// Flow: compose the RFC822 bytes once (MailComposer), SMTP-send those exact
// bytes, then APPEND the same bytes to the account's Sent mailbox — so what
// the recipient got and what sits in Sent are byte-identical.

export interface SendAccount {
  id: string;
  owner_id: string;
  email_address: string;
  smtp_host: string;
  smtp_port: number;
  smtp_security: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  credentials_enc: string;
  provider_preset: string;
  auth_method?: string;
}

export interface OutboundAttachment {
  filename: string;
  contentType?: string;
  content: Buffer;
}

export interface OutboundInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: OutboundAttachment[];
  inReplyTo?: string | null;
  references?: string[];
  fromName?: string | null;
}

export interface SentInfo {
  messageId: string;
  raw: Buffer;
}

const SMTP_IDLE_MS = 2 * 60_000;
type MailTransport = nodemailer.Transporter<SMTPPool.SentMessageInfo, SMTPPool.Options>;

interface SmtpSlot {
  transport: MailTransport;
  signature: string;
  active: number;
  broken: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const smtpSlots = new Map<string, SmtpSlot>();
const smtpBuilds = new Map<string, Promise<SmtpSlot>>();

function smtpSignature(account: SendAccount): string {
  return [
    account.smtp_host,
    account.smtp_port,
    account.smtp_security,
    account.email_address,
    account.auth_method ?? "password",
    account.credentials_enc,
  ].join("\u0000");
}

function closeSmtpSlot(accountId: string, slot: SmtpSlot): void {
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = null;
  if (smtpSlots.get(accountId) === slot) smtpSlots.delete(accountId);
  slot.transport.close();
}

async function buildSmtpSlot(account: SendAccount, signature: string): Promise<SmtpSlot> {
  const oauth = providerForAuthMethod(account.auth_method ?? "password");
  const creds = oauth ? null : decryptCredentials(account.credentials_enc);
  const transport = nodemailer.createTransport({
    pool: true,
    maxConnections: 2,
    maxMessages: 100,
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_security === "tls",
    requireTLS: account.smtp_security === "starttls",
    auth: oauth
      ? {
          type: "OAuth2" as const,
          user: account.email_address,
          accessToken: await getAccessToken(account.id, account.auth_method!, account.credentials_enc),
        }
      : {
          user: account.imap_username,
          pass: creds!.smtp_password ?? creds!.imap_password,
        },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  return { transport, signature, active: 0, broken: false, idleTimer: null };
}

async function acquireSmtp(account: SendAccount): Promise<SmtpSlot> {
  const signature = smtpSignature(account);
  let slot = smtpSlots.get(account.id);
  if (slot && (slot.signature !== signature || slot.broken)) {
    if (slot.active === 0) closeSmtpSlot(account.id, slot);
    slot = undefined;
  }
  if (!slot) {
    let building = smtpBuilds.get(account.id);
    if (!building) {
      building = buildSmtpSlot(account, signature);
      smtpBuilds.set(account.id, building);
    }
    try {
      slot = await building;
      // Credentials may have changed while a connection was being built.
      if (slot.signature !== signature) {
        slot.transport.close();
        smtpBuilds.delete(account.id);
        return acquireSmtp(account);
      }
      smtpSlots.set(account.id, slot);
    } finally {
      if (smtpBuilds.get(account.id) === building) smtpBuilds.delete(account.id);
    }
  }
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = null;
  slot.active += 1;
  return slot;
}

function releaseSmtp(accountId: string, slot: SmtpSlot, failed: boolean): void {
  if (failed) slot.broken = true;
  slot.active = Math.max(0, slot.active - 1);
  if (slot.active > 0) return;
  if (slot.broken || smtpSlots.get(accountId) !== slot) {
    closeSmtpSlot(accountId, slot);
    return;
  }
  slot.idleTimer = setTimeout(() => closeSmtpSlot(accountId, slot), SMTP_IDLE_MS);
  slot.idleTimer.unref?.();
}

export async function smtpSend(
  account: SendAccount,
  input: OutboundInput,
  // Callers that queue the send allocate the Message-ID at ENQUEUE time and
  // pass it here, so any retry goes out under the same id and receiving mail
  // systems dedupe a rare double-delivery. Omitted = nodemailer generates one.
  messageId?: string,
): Promise<SentInfo> {
  const composer = new MailComposer({
    messageId,
    from: input.fromName
      ? { name: input.fromName, address: account.email_address }
      : account.email_address,
    to: input.to,
    cc: input.cc && input.cc.length > 0 ? input.cc : undefined,
    bcc: input.bcc && input.bcc.length > 0 ? input.bcc : undefined,
    subject: input.subject,
    text: input.bodyText,
    html: input.bodyHtml,
    attachments:
      input.attachments && input.attachments.length > 0
        ? input.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.contentType,
          }))
        : undefined,
    inReplyTo: input.inReplyTo ?? undefined,
    references:
      input.references && input.references.length > 0 ? input.references : undefined,
  });
  const mail = composer.compile();
  const raw = await mail.build();
  const finalMessageId = mail.messageId() ?? messageId ?? "";

  // Keep the authenticated SMTP socket warm briefly. The old code paid a
  // fresh DNS/TCP/TLS/auth handshake for every Send or Reply.
  const slot = await acquireSmtp(account);
  let failed = true;
  try {
    await slot.transport.sendMail({
      envelope: {
        from: account.email_address,
        to: [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])],
      },
      raw,
    });
    failed = false;
  } finally {
    releaseSmtp(account.id, slot, failed);
  }

  return { messageId: finalMessageId, raw };
}

/** Best-effort copy to the account's Sent mailbox. Gmail auto-saves on SMTP
 *  send, so gmail-preset accounts skip this (it would duplicate). */
export async function appendToSent(account: SendAccount, raw: Buffer): Promise<void> {
  if (account.provider_preset === "gmail") return;
  try {
    await withActionImap(account, async (client) => {
      // Same resolver as the Sent sync pass, so the folder we APPEND to is the
      // folder the syncer reads back; a mismatch would make every send look
      // like a new unsynced message.
      const sentBox = (await findSentMailbox(client)) ?? "Sent";
      await client.append(sentBox, raw, ["\\Seen"]);
    });
  } catch (err) {
    logger.warn({ err, accountId: account.id }, "sent-folder append failed (non-fatal)");
  }
}

/** Store the outbound message locally so the thread shows it immediately. */
export async function recordOutbound(
  account: SendAccount,
  threadId: string,
  input: OutboundInput,
  messageId: string,
): Promise<void> {
  const snippet = input.bodyText.replace(/\s+/g, " ").trim().slice(0, 140) || null;
  const { error } = await supabase.from("messages").insert({
    owner_id: account.owner_id,
    account_id: account.id,
    thread_id: threadId,
    imap_uid: null,
    imap_mailbox: null,
    message_id: messageId,
    in_reply_to: input.inReplyTo ?? null,
    references_ids: input.references ?? [],
    from_name: input.fromName ?? null,
    from_address: account.email_address.toLowerCase(),
    to_addresses: input.to.map((a) => a.toLowerCase()),
    cc_addresses: (input.cc ?? []).map((a) => a.toLowerCase()),
    subject: input.subject,
    date: new Date().toISOString(),
    body_text: input.bodyText,
    body_html: input.bodyHtml ?? null,
    snippet,
    seen: true,
    direction: "outbound",
    // Metadata only, so the thread shows what was attached. partId "sent"
    // marks these as not fetchable from IMAP (the sender already has them).
    attachments: (input.attachments ?? []).map((a, i) => ({
      partId: `sent-${i + 1}`,
      filename: a.filename,
      contentType: a.contentType ?? "application/octet-stream",
      size: a.content.length,
    })),
  });
  if (error) logger.error({ error, threadId }, "outbound message record failed");
  await Promise.all([
    touchThread(threadId),
    // Replying in a thread promotes it to Important forever, whatever the
    // sender looks like. This update is independent of the rollup and can run
    // alongside it instead of adding another wait after every send.
    supabase
      .from("threads")
      .update({ split_class: "important", split_reason: "Started or replied by you" })
      .eq("id", threadId)
      .eq("split_manual", false)
      .neq("split_class", "important"),
  ]);
}
