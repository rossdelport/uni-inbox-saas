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

async function sendGate(uid: string): Promise<{ error: string | null; fromName: string | null }> {
  const billing = await getBilling(uid);
  if (billing.trialExpired) {
    return { error: "Your trial has ended. Pick a plan to keep sending.", fromName: billing.displayName };
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data: allowed, error } = await supabase.rpc("bump_send_counter", {
    p_user_id: uid,
    p_day: today,
    p_max: env.SEND_DAILY_CAP,
  });
  if (error) {
    logger.error({ error, uid }, "send counter failed");
    return { error: "Sending is temporarily unavailable.", fromName: billing.displayName };
  }
  if (!allowed) {
    return { error: `Daily send limit reached (${env.SEND_DAILY_CAP} per day).`, fromName: billing.displayName };
  }
  return { error: null, fromName: billing.displayName };
}

// Reply to a thread. From-account is the THREAD'S account — server-resolved,
// deliberately not a request field.
// Queue fields shared by every send route. client_token makes a retried or
// double-submitted request resolve to ONE outbox row (optional: the installed
// iOS build sends none and gets a server-side fallback token). send_at is
// Send Later.
const queueFields = {
  client_token: z.string().min(8).max(80).optional(),
  send_at: z.string().datetime({ offset: true }).optional(),
} as const;

function checkSendAt(sendAt: string | undefined): string | null {
  if (!sendAt) return null;
  const t = new Date(sendAt).getTime();
  if (Number.isNaN(t)) return "invalid send time";
  if (t > Date.now() + 31 * 24 * 3600 * 1000) return "Send later is limited to 31 days out.";
  return null;
}

const replyInput = z.object({
  ...queueFields,
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
  // Billing/counter work and thread ownership are independent. Starting both
  // together removes several database round-trips from the time between
  // tapping Reply and beginning the SMTP delivery.
  const gatePromise = sendGate(uid);
  const threadResult = await supabase
    .from("threads")
    .select("id, account_id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  const { data: thread } = threadResult;
  if (!thread) return res.status(404).json({ error: "thread not found" });

  // Start the mailbox/message reads as soon as the thread id arrives while
  // the billing gate performs its second (send-counter) request. That keeps
  // the critical path to roughly two database phases instead of three.
  const [gate, accountResult, replyResult] = await Promise.all([
    gatePromise,
    supabase
      .from("email_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("id", thread.account_id)
      .maybeSingle(),
    // Latest inbound message = what we're replying to.
    supabase
      .from("messages")
      .select("message_id, references_ids, subject, from_address, to_addresses, cc_addresses")
      .eq("thread_id", thread.id)
      .eq("direction", "inbound")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (gate.error) return res.status(402).json({ error: gate.error });
  const { data: account } = accountResult;
  if (!account) return res.status(404).json({ error: "account not found" });
  if (account.status !== "active") {
    return res.status(409).json({
      error: "This inbox is paused (check its connection in Settings), so replies can't be sent from it right now.",
    });
  }

  const { data: replyTo } = replyResult;
  if (!replyTo) return res.status(409).json({ error: "nothing in this thread to reply to" });

  // Reply-all semantics. The connected account's own address is a valid
  // recipient too: users can deliberately reply to a message they sent to
  // themselves (a useful note/test workflow). We still remove it from the
  // automatically collected CC list so it is not duplicated there.
  const self = (account.email_address as string).toLowerCase();
  const to = [replyTo.from_address as string].filter(Boolean);
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
    fromName: gate.fromName,
  };

  const sendAtErr = checkSendAt(parsed.data.send_at);
  if (sendAtErr) return res.status(400).json({ error: sendAtErr });

  try {
    const sent = await smtpSend(account as SendAccount, input);
    // SMTP acceptance is the honest definition of Sent. Do not make the
    // client keep showing "Sending…" while OneInbox refreshes its local
    // thread rollup; persistence and the provider Sent copy can settle in the
    // background, and Sent sync remains the reconciliation safety net.
    void recordOutbound(account as SendAccount, thread.id as string, input, sent.messageId)
      .catch((error) => logger.error({ error, threadId: thread.id }, "outbound record failed after send"));
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
  ...queueFields,
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
  const gatePromise = sendGate(uid);
  const threadResult = await supabase
    .from("threads")
    .select("id, account_id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  const { data: thread } = threadResult;
  if (!thread) return res.status(404).json({ error: "thread not found" });

  const [gate, accountResult, originalResult] = await Promise.all([
    gatePromise,
    supabase
      .from("email_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("id", thread.account_id)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("from_name, from_address, to_addresses, subject, date, body_text, body_html")
      .eq("thread_id", thread.id)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (gate.error) return res.status(402).json({ error: gate.error });
  const { data: account } = accountResult;
  if (!account) return res.status(404).json({ error: "account not found" });
  if (account.status !== "active") {
    return res.status(409).json({ error: "This inbox is paused, so it can't send right now." });
  }

  const { data: original } = originalResult;
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
    fromName: gate.fromName,
  };

  const fwdSendAtErr = checkSendAt(parsed.data.send_at);
  if (fwdSendAtErr) return res.status(400).json({ error: fwdSendAtErr });

  try {
    const sent = await smtpSend(account as SendAccount, input);
    void recordOutbound(account as SendAccount, thread.id as string, input, sent.messageId)
      .catch((error) => logger.error({ error, threadId: thread.id }, "forward record failed after send"));
    void appendToSent(account as SendAccount, sent.raw);
    res.json({ ok: true, message_id: sent.messageId });
  } catch (err) {
    logger.error({ err, uid, threadId: thread.id }, "forward send failed");
    res.status(502).json({ error: "The mail server rejected the send. Try again in a minute." });
  }
});

// Fresh compose. account_id is explicit here (and ownership-checked).
const composeInput = z.object({
  ...queueFields,
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
  const [gate, accountResult] = await Promise.all([
    sendGate(uid),
    supabase
      .from("email_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("id", parsed.data.account_id)
      .eq("owner_id", uid)
      .maybeSingle(),
  ]);
  if (gate.error) return res.status(402).json({ error: gate.error });
  const { data: account } = accountResult;
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
    fromName: gate.fromName,
  };

  const newSendAtErr = checkSendAt(parsed.data.send_at);
  if (newSendAtErr) return res.status(400).json({ error: newSendAtErr });

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
      // Compose is the only path that creates a thread from a message we sent,
      // and the one that produced the phantom Inbox rows. Reply and forward
      // reuse an existing thread through recordOutbound.
      direction: "outbound",
    });
    await recordOutbound(account as SendAccount, threadId, input, sent.messageId);
    void appendToSent(account as SendAccount, sent.raw);
    res.json({ ok: true, thread_id: threadId, message_id: sent.messageId });
  } catch (err) {
    logger.error({ err, uid }, "compose send failed");
    res.status(502).json({ error: "The mail server rejected the send. Try again in a minute." });
  }
});
