import { Router } from "express";
import { z } from "zod";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { wakeAccount } from "../services/imapSync.js";
import { backfillOlder } from "../services/backfill.js";
import { logger } from "../lib/logger.js";
import { rememberSplitRule, senderDomain, normalizeSender } from "../services/splitRules.js";
import { findSpecialUse, withImap } from "../services/imapClient.js";

export const inboxRouter = Router();

const PAGE_SIZE = 50;
// "Not snoozed" sentinel: NOT NULL epoch, so the inbox filter stays a single
// method-arg .lte instead of an or= (which mis-parses ISO timestamps; see the
// applyFlagOps comment in imapSync.ts). Mapped to null on the wire.
const SNOOZE_NONE = "1970-01-01T00:00:00+00:00";
// Sent is resolved by collecting outbound message thread ids first, so it can
// only reach back this far. Well beyond what a solo founder sends in months,
// and it keeps the id list a sane size for a single query.
const SENT_LOOKBACK = 500;

// Keyset cursor: base64 of "<sort_value>|<thread_id>". Stable under new-mail
// inserts, unlike offset pagination. The sort value is whichever column is
// ordering the current view (see SORT_COL below), so the cursor stays
// consistent with it.
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
  const sent = String(req.query.sent ?? "0") === "1";
  const account = typeof req.query.account === "string" ? req.query.account : null;
  const cursor = typeof req.query.cursor === "string" ? decodeCursor(req.query.cursor) : null;
  // Split chip. Anything unrecognised degrades to "all" rather than erroring:
  // the installed iOS build ships independently and cannot be rolled back
  // alongside the API, so an unknown value must never break the list.
  const rawSplit = typeof req.query.split === "string" ? req.query.split : "all";
  const split = (["important", "newsletter", "other"] as const).find((s) => s === rawSplit) ?? null;
  // PostgREST or() syntax breaks on commas/parens; spaces search fine.
  const q =
    typeof req.query.q === "string"
      ? req.query.q.trim().replace(/[,()%]/g, " ").trim().slice(0, 120)
      : "";

  // Inbox-style views order by mail RECEIVED, so replying to a thread does
  // not bump it to the top of your own inbox; it rises when someone replies
  // to you. Sent orders by last activity, which is the reply you just sent.
  const sortCol = sent ? "last_message_at" : "last_inbound_at";

  let query = supabase
    .from("threads")
    .select(
      "id, account_id, subject_norm, snippet, last_message_at, last_inbound_at, message_count, unread, archived, starred, read_later, snooze_until, snooze_woke_at, split_class, split_reason, split_manual, email_accounts!inner(label, color, email_address, created_at)",
    )
    .eq("owner_id", uid)
    .order(sortCol, { ascending: false })
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
  } else if (sent) {
    // Sent = threads this user has replied to or started. "Outbound" lives on
    // messages, so collect their thread ids first. Archived state is ignored
    // here: something you sent stays in Sent wherever the thread ends up.
    let outQuery = supabase
      .from("messages")
      .select("thread_id")
      .eq("owner_id", uid)
      .eq("direction", "outbound")
      .order("date", { ascending: false })
      .limit(SENT_LOOKBACK);
    if (account) outQuery = outQuery.eq("account_id", account);
    const { data: outHits } = await outQuery;
    const ids = [...new Set((outHits ?? []).map((m) => m.thread_id as string))];
    query = query.is("deleted_at", null);
    if (account) query = query.eq("account_id", account);
    // No sent mail yet: return an empty page rather than the whole inbox.
    if (ids.length === 0) return res.json({ threads: [], next_cursor: null });
    query = query.in("id", ids);
  } else {
    query = deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
    if (!deleted) query = query.eq("archived", archived);
    if (account) query = query.eq("account_id", account);
    if (starred) query = query.eq("starred", true);
    if (later) query = query.eq("read_later", true);
    // The plain Inbox shows mail that ARRIVED. A thread you started and nobody
    // has answered lives in Sent until a reply lands, at which point
    // touchThread sets has_inbound and it appears here.
    //
    // Scoped to the plain Inbox on purpose: Starred, Read later, Archived and
    // Deleted are things the user explicitly filed, so a sent-only thread they
    // starred must still be findable under Starred.
    if (!deleted && !archived && !starred && !later) {
      query = query.eq("has_inbound", true);
      // A snoozed thread is out of the Inbox until its wake time. Evaluated
      // per request, so a dead worker can never hide mail past the moment the
      // user chose; the sweep only tidies flags and nudges open tabs.
      query = query.lte("snooze_until", new Date().toISOString());
      // Splits partition the plain Inbox only, matching where the guard above
      // already draws the Inbox-only line: Starred, Later, Archived and
      // Deleted are things the user explicitly filed, and a filed thread must
      // stay findable whatever pile it started in.
      if (split) query = query.eq("split_class", split);
    }
  }
  if (cursor && !q) {
    // Keyset: strictly older than the cursor row (ties broken by id).
    query = query.or(
      `${sortCol}.lt.${cursor.lastMessageAt},` +
        `and(${sortCol}.eq.${cursor.lastMessageAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: "could not load inbox" });

  const rows = data ?? [];
  const page = rows.slice(0, PAGE_SIZE);

  // Who to show on each list row. Everywhere except Sent that is the newest
  // message's sender. In Sent every message is from the user, so naming the
  // sender would print their own name down the whole list; the useful identity
  // there is who it went TO.
  const threadIds = page.map((t) => t.id as string);
  const latestFrom = new Map<string, { name: string | null; address: string | null; subject: string | null }>();
  if (threadIds.length > 0) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("thread_id, from_name, from_address, to_addresses, subject, date, direction")
      .in("thread_id", threadIds)
      .order("date", { ascending: false });
    // Two passes over the same rows. The preferred direction depends on the
    // view: Sent rows are labelled by recipient (every sender is the user), an
    // inbox row is labelled by the newest INBOUND sender. Before Sent sync the
    // newest message was almost always inbound, so "newest overall" worked;
    // now a thread the user just replied to has an outbound row on top, and
    // without the direction filter the whole inbox would relabel itself with
    // the user's own name as they replied. The second pass fills threads that
    // only have the other direction (a sent-only thread starred into view),
    // formatted for what it is.
    const fill = (m: {
      thread_id: unknown; from_name: unknown; from_address: unknown;
      to_addresses: unknown; subject: unknown; direction: unknown;
    }) => {
      const tid = m.thread_id as string;
      if (latestFrom.has(tid)) return;
      const outbound = m.direction === "outbound";
      const recipients = (m.to_addresses as string[] | null) ?? [];
      const to = recipients[0] ?? null;
      const extra = recipients.length > 1 ? ` +${recipients.length - 1}` : "";
      latestFrom.set(tid, {
        name: outbound ? (to ? `To ${to}${extra}` : null) : ((m.from_name as string | null) ?? null),
        address: outbound ? to : ((m.from_address as string | null) ?? null),
        subject: (m.subject as string | null) ?? null,
      });
    };
    const preferred = sent ? "outbound" : "inbound";
    for (const m of msgs ?? []) if (m.direction === preferred) fill(m);
    for (const m of msgs ?? []) fill(m);
  }

  const threads = page.map((t) => {
    const acct = t.email_accounts as unknown as {
      label: string;
      color: string;
      email_address: string;
      created_at: string;
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
      // The row timestamp follows whatever the view is sorted by, otherwise
      // a thread could show a later time than the one above it.
      last_message_at: t[sortCol],
      message_count: t.message_count,
      unread: t.unread,
      archived: t.archived,
      starred: t.starred,
      read_later: t.read_later,
      split_class: t.split_class,
      split_reason: t.split_reason,
      split_manual: t.split_manual,
      // Epoch sentinel means "not snoozed"; clients only ever see a real
      // wake time or null.
      snooze_until: String(t.snooze_until) > SNOOZE_NONE ? t.snooze_until : null,
      // Whether this row is part of the sidebar/tab-title count, which only
      // includes mail that arrived after the account was connected. Sent by
      // the server so the client can drop the badge the instant a thread is
      // opened, without having to reimplement the rule and drift from it.
      counts_unread:
        Boolean(t.unread) &&
        (String(t.last_inbound_at) >= String(acct.created_at) || Boolean(t.snooze_woke_at)),
    };
  });

  const last = page[page.length - 1];
  res.json({
    threads,
    // Search is a single page (top 50 across every mailbox).
    next_cursor:
      !q && rows.length > PAGE_SIZE && last
        ? encodeCursor(last[sortCol] as string, last.id as string)
        : null,
  });
});

// POST /api/inbox/threads/:id/split — correct the category for this thread,
// optionally remembering the choice for this sender or domain in this inbox.
// This route is deliberately before /threads/:id/:op below: "split" is a
// classifier action, not an IMAP flag operation.
const splitInput = z.object({
  split_class: z.enum(["important", "newsletter", "other"]),
  remember: z.enum(["thread", "sender", "domain"]).default("thread"),
});

inboxRouter.post("/threads/:id/split", async (req, res) => {
  const uid = userId(res);
  const parsed = splitInput.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid category" });
  const { split_class, remember } = parsed.data;

  const { data: thread } = await supabase
    .from("threads")
    .select("id, account_id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) return res.status(404).json({ error: "thread not found" });

  const { data: inbound } = await supabase
    .from("messages")
    .select("from_address, from_name")
    .eq("thread_id", thread.id)
    .eq("direction", "inbound")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fromAddress = normalizeSender(String(inbound?.from_address ?? ""));
  const domain = senderDomain(fromAddress);
  const reason = remember === "thread"
    ? "You chose this category"
    : remember === "sender"
      ? "Your rule for this sender"
      : "Your rule for this domain";

  const { error: updateError } = await supabase
    .from("threads")
    .update({ split_class, split_reason: reason, split_manual: true })
    .eq("id", thread.id)
    .eq("owner_id", uid);
  if (updateError) {
    logger.warn({ err: updateError, threadId: thread.id }, "thread category update failed");
    return res.status(500).json({ error: "could not update category" });
  }

  if (remember !== "thread") {
    const value = remember === "sender" ? fromAddress : domain;
    if (!value) return res.status(400).json({ error: "This conversation has no sender address to remember." });
    try {
      await rememberSplitRule(uid, thread.account_id as string, remember, value, split_class);
    } catch (error) {
      logger.warn({ err: error, threadId: thread.id }, "split rule save failed");
      return res.status(500).json({ error: "category saved, but the future-mail rule could not be saved" });
    }

    // Apply a new sender/domain rule to existing matching conversations too.
    // Marking those rows manual keeps a future personal reply from undoing a
    // choice the user explicitly said should always apply.
    let matchQuery = supabase
      .from("messages")
      .select("thread_id")
      .eq("owner_id", uid)
      .eq("account_id", thread.account_id)
      .eq("direction", "inbound");
    matchQuery = remember === "sender"
      ? matchQuery.eq("from_address", fromAddress)
      : matchQuery.ilike("from_address", `%@${domain}`);
    const { data: matches } = await matchQuery.limit(2000);
    const ids = [...new Set((matches ?? []).map((row) => row.thread_id as string))];
    if (ids.length > 0) {
      await supabase
        .from("threads")
        .update({ split_class, split_reason: reason, split_manual: true })
        .in("id", ids)
        .eq("owner_id", uid);
    }
  }

  res.json({ ok: true, split_class, split_reason: reason, remember });
});

// POST /api/inbox/backfill?account=<id>
// Pulls the next block of older mail once the user has scrolled past
// everything stored. Without an account it walks every active mailbox, which
// is what the unified "All inboxes" view needs.
inboxRouter.post("/backfill", async (req, res) => {
  const uid = userId(res);
  const account = typeof req.query.account === "string" ? req.query.account : null;

  let ids: string[];
  if (account) {
    ids = [account];
  } else {
    const { data } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("owner_id", uid)
      .eq("status", "active");
    ids = (data ?? []).map((a) => a.id as string);
  }

  let added = 0;
  let exhausted = true;
  for (const id of ids) {
    try {
      const r = await backfillOlder(id, uid);
      added += r.added;
      // The view still has more to give if ANY mailbox does.
      if (!r.exhausted) exhausted = false;
    } catch (err) {
      // One unreachable mailbox must not fail the whole request; the others
      // may still have older mail to contribute.
      logger.warn({ err, accountId: id }, "backfill failed for account");
    }
  }
  res.json({ added, exhausted });
});

// GET /api/inbox/counts — the numbers on the sidebar and in the tab title.
//
// Counts only mail that arrived AFTER the account was connected. Connecting a
// mailbox imports its whole backlog, and mirroring the server's \Seen flags
// honestly meant one account alone could open with 625 unread. A badge reading
// 625 on day one is noise: nobody acts on it, and it buries the one message
// that actually arrived since.
//
// The unread flag itself is untouched, so those older messages keep their dot
// in the list. Unread is a fact about the mailbox; the badge is a claim that
// something needs attention, and only new mail earns that.
inboxRouter.get("/counts", async (_req, res) => {
  const uid = userId(res);
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("id, created_at")
    .eq("owner_id", uid)
    .neq("status", "disabled");
  if (error) {
    logger.error({ err: error, uid }, "unread counts failed");
    return res.status(502).json({ error: "Could not load counts." });
  }

  // One grouped RPC instead of a HEAD count per account: the dashboard polls
  // this endpoint from every open tab, and the split strip needs a per-split
  // breakdown that would otherwise make the loop 4N queries. The function's
  // predicate is the Inbox list's, verbatim, so the badge can never count a
  // thread the Inbox does not show.
  const { data: rows, error: countErr } = await supabase.rpc("inbox_counts", { p_owner: uid });
  if (countErr) {
    logger.error({ err: countErr, uid }, "inbox_counts rpc failed");
    return res.status(502).json({ error: "Could not load counts." });
  }

  // Accounts with zero unread get an explicit 0 rather than a missing key
  // (GROUP BY omits empty groups), so clients never distinguish "no unread"
  // from "unknown account".
  const byAccount: Record<string, number> = {};
  const byAccountSplit: Record<string, Record<string, number>> = {};
  for (const a of accounts ?? []) {
    byAccount[a.id as string] = 0;
    byAccountSplit[a.id as string] = { important: 0, newsletter: 0, other: 0 };
  }
  let total = 0;
  for (const r of (rows ?? []) as Array<{ account_id: string; split_class: string; unread: number }>) {
    const n = Number(r.unread) || 0;
    byAccount[r.account_id] = (byAccount[r.account_id] ?? 0) + n;
    (byAccountSplit[r.account_id] ??= { important: 0, newsletter: 0, other: 0 })[r.split_class] = n;
    total += n;
  }
  // Invariants: by_account[id] equals the sum of by_account_split[id], and
  // total equals the sum of by_account. The first two keys are unchanged, so
  // the installed iOS build keeps working untouched.
  res.json({ total, by_account: byAccount, by_account_split: byAccountSplit });
});

// POST /api/inbox/read-all — clear unread across whatever the user is
// currently looking at. Takes the same view filters as the list above so
// "read all" means the list on screen, not every thread they own: hitting it
// on Starred must not silently read the rest of the mailbox.
//
// Bounded rather than unbounded: each thread also queues an IMAP flag op, so
// an account with 20k unread would otherwise write 20k rows and hand the flag
// pump a queue it works through for a very long time. Anything above the cap
// is left unread and reported, so the button can simply be pressed again.
const READ_ALL_CAP = 2000;

inboxRouter.post("/read-all", async (req, res) => {
  const uid = userId(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const account = typeof body.account === "string" ? body.account : null;
  const archived = body.archived === true;
  const starred = body.starred === true;
  const later = body.later === true;
  const split =
    (["important", "newsletter", "other"] as const).find((s) => s === body.split) ?? null;

  let q = supabase
    .from("threads")
    .select("id, account_id")
    .eq("owner_id", uid)
    .eq("unread", true)
    .is("deleted_at", null)
    .eq("archived", archived)
    .limit(READ_ALL_CAP);
  if (account) q = q.eq("account_id", account);
  if (starred) q = q.eq("starred", true);
  if (later) q = q.eq("read_later", true);
  // Same predicate as the list, so "Read all" acts on exactly what the Inbox
  // shows. A sent-only thread can still carry unread=true (the Sent tab offers
  // a mark-unread action), and without this it would be swept up invisibly and
  // queue a flag op for a thread that has no INBOX uid to apply it to. The
  // split scope rides the same guard: "Read all" while parked on Important
  // must not mark the newsletters read too.
  if (!archived && !starred && !later) {
    q = q.eq("has_inbound", true);
    // Same snooze predicate as the list: "Read all" must not mark mail the
    // Inbox is deliberately hiding until later.
    q = q.lte("snooze_until", new Date().toISOString());
    if (split) q = q.eq("split_class", split);
  }

  const { data: rows, error } = await q;
  if (error) {
    logger.error({ err: error, uid }, "read-all lookup failed");
    return res.status(502).json({ error: "Could not mark everything read." });
  }
  const threads = rows ?? [];
  if (threads.length === 0) return res.json({ marked: 0, remaining: false });

  const ids = threads.map((t) => t.id as string);
  await supabase.from("threads").update({ unread: false }).in("id", ids);
  await supabase
    .from("messages")
    .update({ seen: true })
    .in("thread_id", ids)
    .eq("direction", "inbound");

  // One op per thread, same as the single-thread path, so the read state
  // reaches Gmail and friends rather than only living in our database.
  await supabase.from("flag_ops").insert(
    threads.map((t) => ({ account_id: t.account_id as string, thread_id: t.id as string, op: "read" })),
  );
  for (const id of new Set(threads.map((t) => t.account_id as string))) {
    await wakeAccount(id);
  }

  logger.info({ uid, marked: ids.length, account }, "read-all applied");
  res.json({ marked: ids.length, remaining: ids.length === READ_ALL_CAP });
});

// POST /api/inbox/threads/:id/snooze — hide until a chosen time. Local only:
// IMAP has no snooze concept, and flag_ops' CHECK constraint would reject the
// op anyway. Registered BEFORE /threads/:id/:op, which would otherwise
// swallow "snooze" and 404 it as an unknown action.
const snoozeInput = z.object({
  // Client sends an ISO instant. Bounded to [now-5min, now+1year]: the small
  // backwards allowance forgives clock skew, the ceiling catches a garbage
  // date before it hides a thread for a decade.
  until: z.string().datetime({ offset: true }),
});

inboxRouter.post("/threads/:id/snooze", async (req, res) => {
  const uid = userId(res);
  const parsed = snoozeInput.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid snooze time" });
  const until = new Date(parsed.data.until);
  const now = Date.now();
  if (Number.isNaN(until.getTime()) || until.getTime() < now - 5 * 60_000) {
    return res.status(400).json({ error: "The snooze time has already passed." });
  }
  if (until.getTime() > now + 366 * 24 * 3600 * 1000) {
    return res.status(400).json({ error: "Snooze is limited to one year out." });
  }

  const { data: thread } = await supabase
    .from("threads")
    .select("id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) return res.status(404).json({ error: "thread not found" });

  // read_later comes along so the thread shows in the Snoozed list, which
  // filters on read_later alone (that keeps the installed iOS build's Later
  // tab correct without an app update).
  const { error } = await supabase
    .from("threads")
    .update({
      snooze_until: until.toISOString(),
      snoozed_at: new Date().toISOString(),
      snooze_woke_at: null,
      read_later: true,
    })
    .eq("id", thread.id);
  if (error) {
    logger.error({ err: error, threadId: thread.id }, "snooze failed");
    return res.status(500).json({ error: "could not snooze thread" });
  }
  res.json({ ok: true, snooze_until: until.toISOString() });
});

class RemoteMailboxMoveError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = "RemoteMailboxMoveError";
    this.statusCode = statusCode;
  }
}

type MailboxDestination = "trash" | "inbox";

/**
 * Move every server-backed message in a thread to a real mailbox folder.
 *
 * The local Deleted view is deliberately updated only after the provider
 * confirms the move. UID mappings are stored when the server provides them;
 * otherwise the next sync must re-address the message before a permanent
 * delete is allowed.
 */
async function moveThreadMailbox(ownerId: string, threadId: string, destinationKind: MailboxDestination): Promise<void> {
  const { data: thread, error: threadError } = await supabase
    .from("threads")
    .select("account_id")
    .eq("id", threadId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (threadError) throw new RemoteMailboxMoveError("Could not prepare the mailbox move.", 502);
  if (!thread) throw new RemoteMailboxMoveError("Thread not found.", 404);

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id, imap_uid, imap_mailbox")
    .eq("thread_id", threadId)
    .eq("owner_id", ownerId);
  if (messagesError) throw new RemoteMailboxMoveError("Could not prepare the mailbox move.", 502);

  const rows = (messages ?? []) as {
    id: string;
    imap_uid: number | string | null;
    imap_mailbox: string | null;
  }[];
  if (rows.some((row) => row.imap_uid === null || row.imap_uid === undefined || !row.imap_mailbox)) {
    throw new RemoteMailboxMoveError("Some messages are still syncing. Sync this mailbox, then try again.");
  }

  const { data: account, error: accountError } = await supabase
    .from("email_accounts")
    .select("id, imap_host, imap_port, imap_username, credentials_enc, provider_preset, auth_method")
    .eq("id", thread.account_id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (accountError) throw new RemoteMailboxMoveError("Could not prepare the mailbox move.", 502);
  if (!account) throw new RemoteMailboxMoveError("Mailbox not found.", 404);

  await withImap(account, async (client) => {
    let destination: string | null = destinationKind === "inbox" ? "INBOX" : await findSpecialUse(client, "\\Trash");
    if (!destination && destinationKind === "trash" && account.provider_preset === "gmail") {
      destination = "[Gmail]/Trash";
    }
    if (!destination) {
      throw new RemoteMailboxMoveError("This mailbox does not expose a Trash folder, so the message was not moved.");
    }

    try {
      await client.mailboxOpen(destination, { readOnly: true });
    } catch {
      throw new RemoteMailboxMoveError("This mailbox does not expose a usable destination folder, so the message was not moved.");
    }

    const grouped = new Map<string, { id: string; uid: number }[]>();
    for (const row of rows) {
      const uid = Number(row.imap_uid);
      if (!Number.isSafeInteger(uid) || uid <= 0) {
        throw new RemoteMailboxMoveError("Some messages are still syncing. Sync this mailbox, then try again.");
      }
      const list = grouped.get(row.imap_mailbox!) ?? [];
      list.push({ id: row.id, uid });
      grouped.set(row.imap_mailbox!, list);
    }

    const needsMove = [...grouped.keys()].some((source) => source !== destination);
    if (needsMove && !client.capabilities.has("MOVE") && !client.capabilities.has("UIDPLUS")) {
      throw new RemoteMailboxMoveError("This mailbox cannot safely move one conversation at a time.");
    }

    for (const [source, items] of grouped) {
      if (source === destination) continue;
      await client.mailboxOpen(source, { readOnly: false });
      const uids = items.map((item) => item.uid);
      // Prefer UID MOVE. If the server has UIDPLUS but not MOVE, do the
      // copy-then-UID-EXPUNGE sequence ourselves instead of relying on a
      // library fallback that could expunge before confirming the copy.
      let moved;
      if (client.capabilities.has("MOVE")) {
        moved = await client.messageMove(uids, destination, { uid: true });
      } else if (client.capabilities.has("UIDPLUS")) {
        const copied = await client.messageCopy(uids, destination, { uid: true });
        if (!copied) {
          throw new RemoteMailboxMoveError("The mail server refused to copy this conversation to Trash.", 502);
        }
        const expunged = await client.messageDelete(uids, { uid: true });
        if (!expunged) {
          throw new RemoteMailboxMoveError("The mail server copied the conversation but refused to remove the original.", 502);
        }
        moved = copied;
      } else {
        throw new RemoteMailboxMoveError("This mailbox cannot safely move one conversation at a time.");
      }
      if (!moved) {
        throw new RemoteMailboxMoveError("The mail server refused to move this conversation.", 502);
      }

      const uidMap = typeof moved === "object" ? moved.uidMap : undefined;
      for (const item of items) {
        const nextUid = uidMap?.get(item.uid) ?? null;
        const { error: updateError } = await supabase
          .from("messages")
          .update({ imap_mailbox: destination, imap_uid: nextUid })
          .eq("id", item.id)
          .eq("owner_id", ownerId);
        if (updateError) {
          throw new RemoteMailboxMoveError("The message moved, but OneInbox could not update its mailbox record.", 502);
        }
      }
    }
  });
}

// Thread-level state flips. Local change is immediate for app-only actions;
// read/archive are queued for IMAP, and restore first moves the message back
// into the provider's Inbox.
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

  if (op === "restore") {
    try {
      await moveThreadMailbox(uid, thread.id as string, "inbox");
    } catch (err) {
      if (err instanceof RemoteMailboxMoveError) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      logger.warn({ err, threadId: thread.id }, "restore mailbox move failed");
      return res.status(502).json({ error: "Could not restore this conversation to your mailbox." });
    }
  }

  const local: Record<string, unknown> =
    op === "archive"
      ? { archived: true }
      : op === "unarchive"
        ? { archived: false }
        : op === "read"
          ? { unread: false, snooze_woke_at: null }
          : op === "unread"
            ? { unread: true }
            : op === "star"
              ? { starred: true }
              : op === "unstar"
                ? { starred: false }
                : op === "later"
                  ? { read_later: true, snooze_woke_at: null }
                  : op === "unlater"
                    // Also clears any snooze: "remove from Later" is the only
                    // unsnooze the installed iOS build has, and without this a
                    // snoozed thread it removed would stay hidden from the
                    // Inbox until its wake time with no way to see why.
                    ? {
                        read_later: false,
                        snooze_until: SNOOZE_NONE,
                        snoozed_at: null,
                        snooze_woke_at: null,
                      }
                    : { deleted_at: null }; // restore from trash
  await supabase.from("threads").update(local).eq("id", thread.id);
  if (op === "read" || op === "unread") {
    await supabase
      .from("messages")
      .update({ seen: op === "read" })
      .eq("thread_id", thread.id)
      .eq("direction", "inbound");
  }

  // Star and read-later are app-local state; read/archive ops mirror to IMAP
  // through the flag queue. Restore already moved the message into INBOX
  // above, so it does not need a second queued operation.
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

// DELETE /api/inbox/threads/:id — move the conversation to the provider's
// Trash, then show it in OneInbox's Deleted view. It remains restorable until
// the user permanently deletes it or the 30-day local retention sweep runs.
inboxRouter.delete("/threads/:id", async (req, res) => {
  const uid = userId(res);
  const { data: thread } = await supabase
    .from("threads")
    .select("id")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) return res.status(404).json({ error: "thread not found" });

  try {
    await moveThreadMailbox(uid, thread.id as string, "trash");
  } catch (err) {
    if (err instanceof RemoteMailboxMoveError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    logger.warn({ err, threadId: thread.id }, "trash mailbox move failed");
    return res.status(502).json({ error: "Could not move this conversation to your mailbox Trash." });
  }

  const { error } = await supabase
    .from("threads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", thread.id);
  if (error) return res.status(500).json({ error: "could not delete thread" });
  res.json({ ok: true });
});

/**
 * Permanently remove a deleted conversation from the connected mailbox and
 * from OneInbox. This deliberately requires UIDPLUS: without UID EXPUNGE,
 * IMAP's plain EXPUNGE removes every message already marked Deleted in that
 * mailbox, not just the conversation the user selected.
 */
class PermanentDeleteUnsupportedError extends Error {}

inboxRouter.delete("/threads/:id/permanent", async (req, res) => {
  const uid = userId(res);
  const { data: thread, error: threadError } = await supabase
    .from("threads")
    .select("id, account_id, deleted_at")
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (threadError) return res.status(500).json({ error: "could not find thread" });
  if (!thread) return res.status(404).json({ error: "thread not found" });
  if (!thread.deleted_at) {
    return res.status(409).json({ error: "Only conversations in Deleted can be removed permanently." });
  }

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("imap_uid, imap_mailbox")
    .eq("thread_id", thread.id)
    .eq("owner_id", uid);
  if (messagesError) return res.status(500).json({ error: "could not prepare permanent deletion" });
  if ((messages ?? []).some((message) => message.imap_uid === null || message.imap_uid === undefined || !message.imap_mailbox)) {
    return res.status(409).json({
      error: "Some messages are still syncing. Sync this mailbox, then try permanent deletion again.",
    });
  }

  const { data: account, error: accountError } = await supabase
    .from("email_accounts")
    .select("id, imap_host, imap_port, imap_username, credentials_enc, provider_preset, auth_method")
    .eq("id", thread.account_id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (accountError) return res.status(500).json({ error: "could not prepare permanent deletion" });
  if (!account) return res.status(404).json({ error: "mailbox not found" });

  // A thread can contain messages from INBOX and Sent. Group by mailbox so
  // each UID is deleted from the folder in which it was originally synced.
  const mailboxUids = new Map<string, number[]>();
  for (const message of messages ?? []) {
    const imapUid = Number(message.imap_uid);
    if (!Number.isSafeInteger(imapUid) || imapUid <= 0) continue;
    const current = mailboxUids.get(message.imap_mailbox) ?? [];
    if (!current.includes(imapUid)) current.push(imapUid);
    mailboxUids.set(message.imap_mailbox, current);
  }

  try {
    if (mailboxUids.size > 0) {
      await withImap(account, async (client) => {
        // Preflight every mailbox before deleting anything. UIDPLUS makes
        // this operation safe when other messages are already in the trash.
        for (const mailbox of mailboxUids.keys()) {
          await client.mailboxOpen(mailbox, { readOnly: true });
          if (!client.capabilities.has("UIDPLUS")) {
            throw new PermanentDeleteUnsupportedError(
              "This mailbox cannot safely delete one conversation at a time. It is still available in Deleted.",
            );
          }
        }

        for (const [mailbox, uids] of mailboxUids) {
          await client.mailboxOpen(mailbox, { readOnly: false });
          const deleted = await client.messageDelete(uids, { uid: true });
          if (!deleted) throw new Error(`IMAP could not delete messages from ${mailbox}`);
        }
      });
    }

    // Remove local rows only after the provider confirms the permanent
    // delete. Messages, flag operations, and AI summaries cascade from the
    // thread; pending outbox rows deliberately retain their audit row but no
    // longer point at a deleted thread (0023 uses ON DELETE SET NULL).
    const { error: deleteError } = await supabase
      .from("threads")
      .delete()
      .eq("id", thread.id)
      .eq("owner_id", uid);
    if (deleteError) {
      logger.error({ err: deleteError, threadId: thread.id }, "local cleanup failed after permanent delete");
      return res.status(500).json({ error: "Mail was deleted from the provider, but OneInbox could not finish cleanup." });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof PermanentDeleteUnsupportedError) {
      return res.status(409).json({ error: err.message });
    }
    logger.warn({ err, threadId: thread.id }, "permanent thread deletion failed");
    return res.status(502).json({ error: "Could not permanently delete this conversation from your mailbox." });
  }
});
