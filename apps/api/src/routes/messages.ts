import { Router } from "express";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { withImap } from "../services/imapClient.js";

export const messagesRouter = Router();

// Full thread detail: the thread row + every message, oldest first.
messagesRouter.get("/threads/:id", async (req, res) => {
  const uid = userId(res);
  // Both reads are owner-scoped, so they can start together. Opening a
  // conversation used to wait for the thread lookup before even asking for
  // its messages, adding a full database round-trip to every click.
  const [threadResult, messagesResult] = await Promise.all([
    supabase
      .from("threads")
      .select(
        "id, account_id, subject_norm, snippet, last_message_at, message_count, unread, archived, starred, read_later, snooze_until, split_class, split_reason, split_manual, email_accounts!inner(label, color, email_address)",
      )
      .eq("id", req.params.id)
      .eq("owner_id", uid)
      .maybeSingle(),
    supabase
      .from("messages")
      .select(
        "id, thread_id, account_id, from_name, from_address, to_addresses, cc_addresses, subject, date, body_text, body_html, snippet, seen, direction, attachments",
      )
      .eq("thread_id", req.params.id)
      .eq("owner_id", uid)
      .order("date", { ascending: true }),
  ]);
  const { data: thread } = threadResult;
  if (!thread) return res.status(404).json({ error: "thread not found" });

  const { data: messages, error } = messagesResult;
  if (error) return res.status(500).json({ error: "could not load messages" });

  const acct = thread.email_accounts as unknown as {
    label: string;
    color: string;
    email_address: string;
  };
  const newest = (messages ?? [])[messages!.length - 1];
  res.json({
    thread: {
      id: thread.id,
      account_id: thread.account_id,
      account_label: acct.label,
      account_color: acct.color,
      account_email: acct.email_address,
      subject: newest?.subject ?? thread.subject_norm,
      snippet: thread.snippet,
      from_name: newest?.from_name ?? null,
      from_address: newest?.from_address ?? null,
      last_message_at: thread.last_message_at,
      message_count: thread.message_count,
      unread: thread.unread,
      archived: thread.archived,
      // Both clients render star / read-later toggles from the thread they
      // are showing. Omitting these here left the buttons reading undefined,
      // so a starred thread showed as unstarred and every tap sent "star"
      // again: the control looked dead and un-starring from inside a
      // conversation was impossible.
      starred: thread.starred,
      read_later: thread.read_later,
      split_class: thread.split_class,
      split_reason: thread.split_reason,
      split_manual: thread.split_manual,
      // Same epoch-sentinel mapping as the list: clients see a wake time or
      // null, never the sentinel.
      snooze_until:
        String(thread.snooze_until) > "1970-01-01T00:00:00+00:00" ? thread.snooze_until : null,
    },
    messages: messages ?? [],
  });
});

// On-demand attachment download, streamed straight from the IMAP server —
// attachment bytes are never stored in our DB.
messagesRouter.get("/messages/:id/attachments/:partId", async (req, res) => {
  const uid = userId(res);
  const { data: message } = await supabase
    .from("messages")
    .select("id, account_id, imap_uid, imap_mailbox, attachments")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!message || !message.imap_uid) {
    return res.status(404).json({ error: "attachment not available" });
  }
  const meta = (message.attachments as { partId: string; filename: string | null; contentType: string | null }[]).find(
    (a) => a.partId === req.params.partId,
  );
  if (!meta) return res.status(404).json({ error: "attachment not found" });

  const { data: account } = await supabase
    .from("email_accounts")
    .select("id, imap_host, imap_port, imap_username, credentials_enc, provider_preset, auth_method")
    .eq("id", message.account_id)
    .maybeSingle();
  if (!account) return res.status(404).json({ error: "account not found" });

  try {
    await withImap(account, async (client) => {
      await client.mailboxOpen(message.imap_mailbox ?? "INBOX", { readOnly: true });
      // Re-parse the message source and stream the matching attachment out.
      const { content } = await client.download(String(message.imap_uid), undefined, { uid: true });
      const { simpleParser } = await import("mailparser");
      const parsed = await simpleParser(content);
      const idx = Number(meta.partId) - 1;
      const attachment = (parsed.attachments ?? [])[idx];
      if (!attachment) throw new Error("attachment part missing");
      res.setHeader("Content-Type", meta.contentType ?? "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${(meta.filename ?? "attachment").replace(/"/g, "")}"`,
      );
      res.end(attachment.content);
    });
  } catch (err) {
    logger.warn({ err, messageId: message.id }, "attachment fetch failed");
    if (!res.headersSent) res.status(502).json({ error: "could not fetch attachment from the mail server" });
  }
});

// Inline MIME images use cid:... URLs inside the email HTML. The iframe cannot
// attach a bearer token itself, so the dashboard fetches each image here and
// gives the frame a local blob URL. Matching against the original MIME source
// also repairs old rows whose attachment metadata predates contentId storage.
messagesRouter.get("/messages/:id/inline/:contentId", async (req, res) => {
  const uid = userId(res);
  const { data: message } = await supabase
    .from("messages")
    .select("id, account_id, imap_uid, imap_mailbox")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!message || !message.imap_uid) {
    return res.status(404).json({ error: "inline image not available" });
  }

  const { data: account } = await supabase
    .from("email_accounts")
    .select("id, imap_host, imap_port, imap_username, credentials_enc, provider_preset, auth_method")
    .eq("id", message.account_id)
    .maybeSingle();
  if (!account) return res.status(404).json({ error: "account not found" });

  const wanted = req.params.contentId.trim().replace(/^<|>$/g, "").toLowerCase();
  try {
    await withImap(account, async (client) => {
      await client.mailboxOpen(message.imap_mailbox ?? "INBOX", { readOnly: true });
      const { content } = await client.download(String(message.imap_uid), undefined, { uid: true });
      const { simpleParser } = await import("mailparser");
      const parsed = await simpleParser(content);
      const image = (parsed.attachments ?? []).find(
        (attachment) =>
          attachment.contentId?.replace(/^<|>$/g, "").toLowerCase() === wanted &&
          attachment.contentType.toLowerCase().startsWith("image/"),
      );
      if (!image) {
        res.status(404).json({ error: "inline image not found" });
        return;
      }
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.end(image.content);
    });
  } catch (err) {
    logger.warn({ err, messageId: message.id }, "inline image fetch failed");
    if (!res.headersSent) res.status(502).json({ error: "could not fetch inline image" });
  }
});
