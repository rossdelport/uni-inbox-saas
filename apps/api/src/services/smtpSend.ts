import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { decryptCredentials } from "../lib/crypto.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { withImap, findSpecialUse } from "./imapClient.js";
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
}

export interface OutboundInput {
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  inReplyTo?: string | null;
  references?: string[];
  fromName?: string | null;
}

export interface SentInfo {
  messageId: string;
  raw: Buffer;
}

export async function smtpSend(account: SendAccount, input: OutboundInput): Promise<SentInfo> {
  const creds = decryptCredentials(account.credentials_enc);

  const composer = new MailComposer({
    from: input.fromName
      ? { name: input.fromName, address: account.email_address }
      : account.email_address,
    to: input.to,
    cc: input.cc && input.cc.length > 0 ? input.cc : undefined,
    subject: input.subject,
    text: input.bodyText,
    html: input.bodyHtml,
    inReplyTo: input.inReplyTo ?? undefined,
    references:
      input.references && input.references.length > 0 ? input.references : undefined,
  });
  const mail = composer.compile();
  const raw = await mail.build();
  const messageId = mail.messageId();

  const transport = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_security === "tls", // 465 implicit TLS; 587 = STARTTLS
    requireTLS: account.smtp_security === "starttls",
    auth: {
      user: account.imap_username,
      pass: creds.smtp_password ?? creds.imap_password,
    },
    logger: false,
  });
  try {
    await transport.sendMail({
      envelope: {
        from: account.email_address,
        to: [...input.to, ...(input.cc ?? [])],
      },
      raw,
    });
  } finally {
    transport.close();
  }

  return { messageId, raw };
}

/** Best-effort copy to the account's Sent mailbox. Gmail auto-saves on SMTP
 *  send, so gmail-preset accounts skip this (it would duplicate). */
export async function appendToSent(account: SendAccount, raw: Buffer): Promise<void> {
  if (account.provider_preset === "gmail") return;
  try {
    await withImap(account, async (client) => {
      const sentBox = (await findSpecialUse(client, "\\Sent")) ?? "Sent";
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
    attachments: [],
  });
  if (error) logger.error({ error, threadId }, "outbound message record failed");
  await touchThread(threadId);
}
