import { Router } from "express";
import { z } from "zod";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { wakeAccount } from "../services/imapSync.js";

export const inboxRouter = Router();

const PAGE_SIZE = 50;

// Keyset cursor: base64 of "<last_message_at>|<thread_id>". Stable under
// new-mail inserts, unlike offset pagination.
function encodeCursor(lastMessageAt: string, id: string): string {
  return Buffer.from(`${lastMessageAt}|${id}`, "utf8").toString("base64url");
}
function decodeCursor(cursor: string): { lastMessageAt: string; id: string } | null {
  try {
    const [lastMessageAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!lastMessageAt || !id) return null;
    return { lastMessageAt, id };
  } catch {
    return null;
  }
}

// GET /api/inbox?cursor=&account=<id>&archived=0|1&starred=1&later=1&deleted=1&q=
// With q set this is SEARCH MODE: every mailbox at once, inbox + archived,
// matching subject/snippet/sender and message bodies. Other filters are
// ignored and results are a single page.
inboxRouter.get("/", async (req, res) => {
  const uid = userId(res);
  const archived = String(req.query.archived ?? "0") === "1";
  const starred = String(req.query.starred ?? "0") === "1";
  const later = String(req.query.later ?? "0") === "1";
  const deleted = String(req.query.deleted ?? "0") === "1";
  const account = typeof req.query.account === "string" ? req.query.account : null;
  const cursor = typeof req.query.cursor === "string" ? decodeCursor(req.query.cursor) : null;
  // PostgREST or() syntax breaks on commas/parens; spaces search fine.
  const q =
    typeof req.query.q === "string"
      ? req.query.q.trim().replace(/[,()%]/g, " ").trim().slice(0, 120)
      : "";

  let query = supabase
    .from("threads")
    .select(
      "id, account_id, subject_norm, snippet, last_message_at, message_count, unread, archived, starred, read_later, email_accounts!inner(label, color, email_address)",
    )
    .eq("owner_id", uid)
    .order("last_message_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (q) {
    // Bodies and senders live on messages; collect their thread ids first.
    const { data: bodyHits } = await supabase
      .from("messages")
      .select("thread_id")
      .eq("owner_id", uid)
      .or(
        `from_name.ilike.%${q}%,from_address.ilike.%${q}%,subject.ilike.%${q}%,body_text.ilike.%${q}%`,
      )
      .limit(300);
    const ids = [...new Set((bodyHits ?? []).map((m) => m.thread_id as string))];
    const ors = [`subject_norm.ilike.%${q}%`, `snippet.ilike.%${q}%`];
    if (ids.length > 0) ors.push(`id.in.(${ids.join(",")})`);
    query = query.is("deleted_at", null).or(ors.join(","));
  } else {
    query = deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
    if (!deleted) query = query.eq("archived", archived);
    if (account) query = query.eq("account_id", account);
    if (starred) query = query.eq("starred", true);
    if (later) query = query.eq("read_later", true);
  }
  if (cursor && !q) {
    // Keyset: strictly older than the cursor row (ties broken by id).
    query = query.or(
      `last_message_at.lt.${cursor.lastMessageAt},` +
        `and(last_message_at.eq.${cursor.lastMessageAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: "could not load inbox" });

  const rows = data ?? [];
  const page = rows.slice(0, PAGE_SIZE);

  // Newest inbound message meta per thread for the list row's "from".
  const threadIds = page.map((t) => t.id as string);
  const latestFrom = new Map<string, { name: string | null; address: string | null; subject: string | null }>();
  if (threadIds.length > 0) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("thread_id, from_name, from_address, subject, date")
      .in("thread_id", threadIds)
      .order("date", { ascending: false });
    for (const m of msgs ?? []) {
      if (!latestFrom.has(m.thread_id as string)) {
        latestFrom.set(m.thread_id as string, {
          name: (m.from_name as string | null) ?? null,
          address: (m.from_address as string | null) ?? null,
          subject: (m.subject as string | null) ?? null,
        });
      }
    }
  }

  const threads = page.map((t) => {
    const acct = t.email_accounts as unknown as {
      label: string;
      color: string;
      email_address: string;
    };
    const from = latestFrom.get(t.id as string);
    return {
      id: t.id,
      account_id: t.account_id,
      account_label: acct.label,
      account_color: acct.color,
      account_email: acct.email_address,
      subject: from?.subject ?? t.subject_norm,
      snippet: t.snippet,
      from_name: from?.name ?? null,
      from_address: from?.address ?? null,
      last_message_at: t.last_message_at,
      message_count: t.message_count,
      unread: t.unread,
      archived: t.archived,
      starred: t.starred,
      read_later: t.read_later,
    };
  });

  const last = page[page.length - 1];
  res.json({
    threads,
    // Search is a single page (top 50 across every mailbox).
    next_cursor:
      !q && rows.length > PAGE_SIZE && last
        ? encodeCursor(last.last_message_at as string, last.id as string)
        : null,
  });
});

// Thread-level state flips. Local change is immediate; a flag_ops row queues
// the same change for the IMAP server, and the account gets nudged.
const flagOps = z.enum([
  "archive", "unarchive", "read", "unread", "star", "unstar", "later", "unlater", "restore",
]);

inboxRouter.post("/threads/:id/:op", async (req, res) => {
  const uid = userId(res);
  const parsedOp = flagOps.safeParse(req.params.op);
  if (!parsedOp.success) return res.status(404).json({ error: "unknown action" });
  const op = parsedOp.data;

  const { data: thread } = await supabase
    .from("threads")
    .select("id, account_id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) return res.status(404).json({ error: "thread not found" });

  const local: Record<string, unknown> =
    op === "archive"
      ? { archived: true }
      : op === "unarchive"
        ? { archived: false }
        : op === "read"
          ? { unread: false }
          : op === "unread"
            ? { unread: true }
            : op === "star"
              ? { starred: true }
              : op === "unstar"
                ? { starred: false }
                : op === "later"
                  ? { read_later: true }
                  : op === "unlater"
                    ? { read_later: false }
                    : { deleted_at: null }; // restore from trash
  await supabase.from("threads").update(local).eq("id", thread.id);
  if (op === "read" || op === "unread") {
    await supabase
      .from("messages")
      .update({ seen: op === "read" })
      .eq("thread_id", thread.id)
      .eq("direction", "inbound");
  }

  // Star, read-later and restore are app-local state; only read/archive ops
  // mirror to the IMAP server.
  if (op !== "star" && op !== "unstar" && op !== "later" && op !== "unlater" && op !== "restore") {
    await supabase.from("flag_ops").insert({
      account_id: thread.account_id,
      thread_id: thread.id,
      op,
    });
    await wakeAccount(thread.account_id as string);
  }
  res.json({ ok: true });
});

// DELETE /api/inbox/threads/:id — move the conversation to the trash.
// Soft delete: it sits in the Deleted view (restorable) until the retention
// sweep purges it 30 days later. The real mailbox is untouched either way.
inboxRouter.delete("/threads/:id", async (req, res) => {
  const uid = userId(res);
  const { data: thread } = await supabase
    .from("threads")
    .select("id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) return res.status(404).json({ error: "thread not found" });
  const { error } = await supabase
    .from("threads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", thread.id);
  if (error) return res.status(500).json({ error: "could not delete thread" });
  res.json({ ok: true });
});
