import { Router } from "express";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { withImap } from "../services/imapClient.js";

export const messagesRouter = Router();

// Full thread detail: the thread row + every message, oldest first.
messagesRouter.get("/threads/:id", async (req, res) => {
  const uid = userId(res);
  const { data: thread } = await supabase
    .from("threads")
    .select(
      "id, account_id, subject_norm, snippet, last_message_at, message_count, unread, archived, email_accounts!inner(label, color, email_address)",
    )
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) return res.status(404).json({ error: "thread not found" });

  const { data: messages, error } = await supabase
    .from("messages")
    .select(
      "id, thread_id, account_id, from_name, from_address, to_addresses, cc_addresses, subject, date, body_text, body_html, snippet, seen, direction, attachments",
    )
    .eq("thread_id", thread.id)
    .order("date", { ascending: true });
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
    .select("id, imap_host, imap_port, imap_username, credentials_enc, provider_preset")
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
