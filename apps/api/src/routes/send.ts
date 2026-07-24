import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { getBilling } from "../lib/plans.js";
import { resolveThread } from "../services/threading.js";
import {
  appendToSent,
  recordOutbound,
  smtpSend,
  type SendAccount,
} from "../services/smtpSend.js";

export const sendRouter = Router();

const ACCOUNT_COLUMNS =
  "id, owner_id, email_address, smtp_host, smtp_port, smtp_security, imap_host, imap_port, imap_username, credentials_enc, provider_preset, auth_method, status" as const;

const emailList = z.array(z.string().email()).min(1).max(20);

// Attachments arrive base64 in the JSON body (express.json limit covers the
// envelope). 5 files, 15 MB decoded total.
const attachmentInput = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().max(150).optional(),
  data_base64: z.string().min(1).max(21_000_000),
});
const attachmentList = z.array(attachmentInput).max(5).optional();

function decodeAttachments(
  list: z.infer<typeof attachmentList>,
): { filename: string; contentType?: string; content: Buffer }[] | { error: string } {
  if (!list || list.length === 0) return [];
  const out = list.map((a) => ({
    filename: a.filename,
    contentType: a.content_type,
    content: Buffer.from(a.data_base64, "base64"),
  }));
  const total = out.reduce((n, a) => n + a.content.length, 0);
  if (total > 15 * 1024 * 1024) return { error: "Attachments are limited to 15 MB per message." };
  return out;
}

async function sendGate(uid: string): Promise<string | null> {
  const billing = await getBilling(uid);
  if (billing.trialExpired) {
    return "Your trial has ended. Pick a plan to keep sending.";
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data: allowed, error } = await supabase.rpc("bump_send_counter", {
    p_user_id: uid,
    p_day: today,
    p_max: env.SEND_DAILY_CAP,
  });
  if (error) {
    logger.error({ error, uid }, "send counter failed");
    return "Sending is temporarily unavailable.";
  }
  if (!allowed) return `Daily send limit reached (${env.SEND_DAILY_CAP} per day).`;
  return null;
}

async function displayName(uid: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", uid)
    .maybeSingle();
  return (data?.display_name as string | null) ?? null;
}

// Reply to a thread. From-account is the THREAD'S account — server-resolved,
// deliberately not a request field.
const replyInput = z.object({
  body_text: z.string().min(1).max(100_000),
  body_html: z.string().max(500_000).optional(),
  cc: z.array(z.string().email()).max(20).optional(),
  bcc: z.array(z.string().email()).max(20).optional(),
  attachments: attachmentList,
});

sendRouter.post("/threads/:id/reply", async (req, res) => {
  const uid = userId(res);
  const parsed = replyInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid input" });
  }
  const gateError = await sendGate(uid);
  if (gateError) return res.status(402).json({ error: gateError });

  const { data: thread } = await supabase
    .from("threads")
    .select("id, account_id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) return res.status(404).json({ error: "thread not found" });

  const { data: account } = await supabase
    .from("email_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", thread.account_id)
    .maybeSingle();
  if (!account) return res.status(404).json({ error: "account not found" });
  if (account.status !== "active") {
    return res.status(409).json({
      error: "This inbox is paused (check its connection in Settings), so replies can't be sent from it right now.",
    });
  }

  // Latest inbound message = what we're replying to.
  const { data: replyTo } = await supabase
    .from("messages")
    .select("message_id, references_ids, subject, from_address, to_addresses, cc_addresses")
    .eq("thread_id", thread.id)
    .eq("direction", "inbound")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!replyTo) return res.status(409).json({ error: "nothing in this thread to reply to" });

  // Reply-all semantics minus our own address.
  const self = (account.email_address as string).toLowerCase();
  const to = [replyTo.from_address as string].filter((a) => a && a !== self);
  const ccAuto = ([...(replyTo.to_addresses ?? []), ...(replyTo.cc_addresses ?? [])] as string[])
    .filter((a) => a && a !== self && !to.includes(a));
  const cc = parsed.data.cc ?? ccAuto;
  if (to.length === 0) return res.status(409).json({ error: "no recipient to reply to" });

  const baseSubject = (replyTo.subject as string | null) ?? "";
  const subject = /^\s*re\s*:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;
  const references = [
    ...(((replyTo.references_ids as string[] | null) ?? [])),
    ...(replyTo.message_id ? [replyTo.message_id as string] : []),
  ];

  const attachments = decodeAttachments(parsed.data.attachments);
  if ("error" in attachments) return res.status(413).json({ error: attachments.error });

  const input = {
    to,
    cc,
    bcc: parsed.data.bcc,
    subject,
    bodyText: parsed.data.body_text,
    bodyHtml: parsed.data.body_html,
    attachments,
    inReplyTo: (replyTo.message_id as string | null) ?? null,
    references,
    fromName: await displayName(uid),
  };

  try {
    const sent = await smtpSend(account as SendAccount, input);
    await recordOutbound(account as SendAccount, thread.id as string, input, sent.messageId);
    void appendToSent(account as SendAccount, sent.raw);
    res.json({ ok: true, message_id: sent.messageId });
  } catch (err) {
    logger.error({ err, uid, threadId: thread.id }, "reply send failed");
    res.status(502).json({ error: "The mail server rejected the send. Try again in a minute." });
  }
});

// Forward the thread's latest message to new recipients, from the thread's
// account. Original body is quoted under a Gmail-style header block.
// (Original attachments are not re-sent in v1; they live on the IMAP server.)
const forwardInput = z.object({
  to: emailList,
  cc: z.array(z.string().email()).max(20).optional(),
  note: z.string().max(20_000).optional(),
});

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

sendRouter.post("/threads/:id/forward", async (req, res) => {
  const uid = userId(res);
  const parsed = forwardInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid input" });
  }
  const gateError = await sendGate(uid);
  if (gateError) return res.status(402).json({ error: gateError });

  const { data: thread } = await supabase
    .from("threads")
    .select("id, account_id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) return res.status(404).json({ error: "thread not found" });

  const { data: account } = await supabase
    .from("email_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", thread.account_id)
    .maybeSingle();
  if (!account) return res.status(404).json({ error: "account not found" });
  if (account.status !== "active") {
    return res.status(409).json({ error: "This inbox is paused, so it can't send right now." });
  }

  const { data: original } = await supabase
    .from("messages")
    .select("from_name, from_address, to_addresses, subject, date, body_text, body_html")
    .eq("thread_id", thread.id)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!original) return res.status(409).json({ error: "nothing in this thread to forward" });

  const baseSubject = (original.subject as string | null) ?? "";
  const subject = /^\s*fwd?\s*:/i.test(baseSubject) ? baseSubject : `Fwd: ${baseSubject}`;
  const fromLine = original.from_name
    ? `${original.from_name} <${original.from_address ?? ""}>`
    : (original.from_address as string | null) ?? "";
  const when = original.date ? new Date(original.date as string).toUTCString() : "";
  const note = parsed.data.note?.trim() ?? "";

  const headerText =
    `---------- Forwarded message ----------\n` +
    `From: ${fromLine}\nDate: ${when}\nSubject: ${baseSubject}\n` +
    `To: ${((original.to_addresses as string[] | null) ?? []).join(", ")}\n\n`;
  const bodyText = `${note ? `${note}\n\n` : ""}${headerText}${(original.body_text as string | null) ?? ""}`;
  const headerHtml =
    `<div style="color:#5f6368;font-size:13px">---------- Forwarded message ----------<br>` +
    `From: ${esc(fromLine)}<br>Date: ${esc(when)}<br>Subject: ${esc(baseSubject)}<br>` +
    `To: ${esc(((original.to_addresses as string[] | null) ?? []).join(", "))}</div><br>`;
  const originalHtml =
    (original.body_html as string | null) ??
    `<pre style="font-family:inherit;white-space:pre-wrap">${esc((original.body_text as string | null) ?? "")}</pre>`;
  const bodyHtml =
    `<div style="font-family:-apple-system,system-ui,sans-serif;font-size:14px;line-height:1.6">` +
    `${note ? `${esc(note).replace(/\n/g, "<br>")}<br><br>` : ""}${headerHtml}${originalHtml}</div>`;

  const input = {
    to: parsed.data.to,
    cc: parsed.data.cc,
    subject,
    bodyText,
    bodyHtml,
    fromName: await displayName(uid),
  };

  try {
    const sent = await smtpSend(account as SendAccount, input);
    await recordOutbound(account as SendAccount, thread.id as string, input, sent.messageId);
    void appendToSent(account as SendAccount, sent.raw);
    res.json({ ok: true, message_id: sent.messageId });
  } catch (err) {
    logger.error({ err, uid, threadId: thread.id }, "forward send failed");
    res.status(502).json({ error: "The mail server rejected the send. Try again in a minute." });
  }
});

// Fresh compose. account_id is explicit here (and ownership-checked).
const composeInput = z.object({
  account_id: z.string().uuid(),
  to: emailList,
  cc: z.array(z.string().email()).max(20).optional(),
  bcc: z.array(z.string().email()).max(20).optional(),
  subject: z.string().min(1).max(500),
  body_text: z.string().min(1).max(100_000),
  body_html: z.string().max(500_000).optional(),
  attachments: attachmentList,
});

sendRouter.post("/messages/send", async (req, res) => {
  const uid = userId(res);
  const parsed = composeInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid input" });
  }
  const gateError = await sendGate(uid);
  if (gateError) return res.status(402).json({ error: gateError });

  const { data: account } = await supabase
    .from("email_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", parsed.data.account_id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!account) return res.status(404).json({ error: "account not found" });
  if (account.status !== "active") {
    return res.status(409).json({ error: "This inbox is paused, so it can't send right now." });
  }

  const attachments = decodeAttachments(parsed.data.attachments);
  if ("error" in attachments) return res.status(413).json({ error: attachments.error });

  const input = {
    to: parsed.data.to,
    cc: parsed.data.cc,
    bcc: parsed.data.bcc,
    subject: parsed.data.subject,
    bodyText: parsed.data.body_text,
    bodyHtml: parsed.data.body_html,
    attachments,
    fromName: await displayName(uid),
  };

  try {
    const sent = await smtpSend(account as SendAccount, input);
    const threadId = await resolveThread({
      ownerId: uid,
      accountId: account.id as string,
      messageId: sent.messageId,
      inReplyTo: null,
      referencesIds: [],
      subject: parsed.data.subject,
      fromAddress: (account.email_address as string).toLowerCase(),
      toAddresses: parsed.data.to.map((a) => a.toLowerCase()),
      date: new Date(),
      snippet: parsed.data.body_text.replace(/\s+/g, " ").trim().slice(0, 140) || null,
      seen: true,
    });
    await recordOutbound(account as SendAccount, threadId, input, sent.messageId);
    void appendToSent(account as SendAccount, sent.raw);
    res.json({ ok: true, thread_id: threadId, message_id: sent.messageId });
  } catch (err) {
    logger.error({ err, uid }, "compose send failed");
    res.status(502).json({ error: "The mail server rejected the send. Try again in a minute." });
  }
});
