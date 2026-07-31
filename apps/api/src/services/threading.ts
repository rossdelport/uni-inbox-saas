import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

// Conversation threading. RFC headers first (References / In-Reply-To against
// message ids we already hold for the account), then a fallback for clients
// that strip them: same account + normalized subject + a shared participant
// within 30 days. Otherwise a new thread.

/** "Re: Re: Fwd: Hello" -> "hello" */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .replace(/^(\s*(re|fwd?|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

export interface IncomingMeta {
  ownerId: string;
  accountId: string;
  messageId: string | null;
  inReplyTo: string | null;
  referencesIds: string[];
  subject: string | null;
  fromAddress: string;
  toAddresses: string[];
  date: Date;
  snippet: string | null;
  seen: boolean;
  /** Which way this message travelled. Decides whether a thread created for it
   *  belongs in the Inbox (mail arrived) or only in Sent (we started it). */
  direction: "inbound" | "outbound";
  /** Split verdict for the message creating this thread. Optional so the
   *  send path (which is always personal mail) can omit it. */
  splitClass?: "important" | "newsletter" | "other";
}

/** Find the thread this message belongs to, or create one. Returns thread id. */
export async function resolveThread(meta: IncomingMeta): Promise<string> {
  const refCandidates = [...meta.referencesIds, meta.inReplyTo].filter(
    (r): r is string => Boolean(r),
  );

  if (refCandidates.length > 0) {
    const { data } = await supabase
      .from("messages")
      .select("thread_id")
      .eq("account_id", meta.accountId)
      .in("message_id", refCandidates)
      .limit(1);
    const hit = data?.[0]?.thread_id as string | undefined;
    if (hit) return hit;
  }

  const subjectNorm = normalizeSubject(meta.subject);
  if (subjectNorm) {
    const since = new Date(meta.date.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: candidates } = await supabase
      .from("threads")
      .select("id")
      .eq("account_id", meta.accountId)
      .eq("subject_norm", subjectNorm)
      .gte("last_message_at", since)
      .limit(5);
    for (const cand of candidates ?? []) {
      // Participant overlap check: someone in this message already appears in
      // the candidate thread (any direction).
      const participants = [meta.fromAddress, ...meta.toAddresses].map((a) => a.toLowerCase());
      const { data: overlap } = await supabase
        .from("messages")
        .select("id")
        .eq("thread_id", cand.id)
        .or(
          `from_address.in.(${participants.map((p) => `"${p}"`).join(",")}),` +
            `to_addresses.ov.{${participants.join(",")}}`,
        )
        .limit(1);
      if (overlap && overlap.length > 0) return cand.id as string;
    }
  }

  const { data: created, error } = await supabase
    .from("threads")
    .insert({
      owner_id: meta.ownerId,
      account_id: meta.accountId,
      subject_norm: subjectNorm || "(no subject)",
      last_message_at: meta.date.toISOString(),
      // Set explicitly, not left to the column default: this row is inserted
      // before touchThread() fills in the rollups, and the inbox sorts on it.
      last_inbound_at: meta.date.toISOString(),
      // A thread born from a message we SENT has received nothing, so it lives
      // in Sent until someone replies. touchThread flips this to true the
      // moment an inbound message lands, and never flips it back.
      has_inbound: meta.direction === "inbound",
      // A thread born from a message we SENT is by definition a person
      // thread; inbound threads take the classifier's verdict.
      split_class: meta.direction === "outbound" ? "important" : (meta.splitClass ?? "important"),
      message_count: 0, // bumped by touchThread below
      unread: !meta.seen,
      snippet: meta.snippet,
    })
    .select("id")
    .single();
  if (error) throw new Error(`thread insert failed: ${error.message}`);
  return created.id as string;
}

/** Refresh a thread's rollup fields after inserting a message into it.
 *  `inboundMail` marks a call from the ingest path, i.e. real mail arriving,
 *  as opposed to a flag reconcile or an outbound send re-counting the rows. */
export async function touchThread(threadId: string, inboundMail = false): Promise<void> {
  const { data: msgs } = await supabase
    .from("messages")
    .select("date, snippet, seen, direction")
    .eq("thread_id", threadId)
    .order("date", { ascending: false });
  if (!msgs || msgs.length === 0) return;
  const newest = msgs[0]!;
  const unread = msgs.some((m) => !m.seen && m.direction === "inbound");
  // msgs is date-descending, so the first inbound one is the newest. This
  // drives inbox ordering: a thread rises when someone replies to you, not
  // when you reply to them. Threads you started and are still awaiting a
  // reply on fall back to the newest message so they sort sensibly.
  const newestInbound = msgs.find((m) => m.direction === "inbound");
  const newestOutbound = msgs.find((m) => m.direction === "outbound");

  // A reply that arrives AFTER a thread was binned pulls it back out of the
  // trash: deleting says "done with this", not "never show me this person
  // again", and silently dropping a real reply is the worst thing an inbox
  // can do. The first version of this cleared deleted_at whenever the thread
  // merely HAD unread messages, and almost every deleted thread does (promos
  // are deleted unread). The 45-second flag reconcile then re-counted the
  // rows and resurrected the deletion a minute or two later, every time. Now
  // rising from the trash requires actual new mail: an ingest-path call AND
  // an inbound message dated after the deletion, so re-ingests of old
  // messages (reconnects, resyncs) cannot do it either.
  let undelete = false;
  let wakeSnooze = false;
  if (inboundMail && newestInbound) {
    const { data: t } = await supabase
      .from("threads")
      .select("deleted_at, snoozed_at, snooze_until")
      .eq("id", threadId)
      .maybeSingle();
    const deletedAt = t?.deleted_at as string | null | undefined;
    undelete = Boolean(
      deletedAt && new Date(newestInbound.date as string).getTime() > new Date(deletedAt).getTime(),
    );
    // New mail wakes a snoozed thread (Superhuman semantics: a reply is more
    // urgent than the timer). Same date guard as undelete, and for the same
    // reason: backfill and resyncs re-ingest OLD mail through this exact
    // path, and mail from before the snooze was set must not cancel it.
    const snoozedAt = t?.snoozed_at as string | null | undefined;
    const snoozeUntil = t?.snooze_until as string | null | undefined;
    wakeSnooze = Boolean(
      snoozedAt &&
        snoozeUntil &&
        new Date(snoozeUntil).getTime() > Date.now() &&
        new Date(newestInbound.date as string).getTime() > new Date(snoozedAt).getTime(),
    );
  }

  const { error: rollupErr } = await supabase
    .from("threads")
    .update({
      last_message_at: newest.date,
      // Kept as a fallback so this stays NOT NULL and remains a safe ORDER BY
      // key. It is no longer what decides Inbox membership; has_inbound is.
      last_inbound_at: newestInbound?.date ?? newest.date,
      message_count: msgs.length,
      snippet: newest.snippet,
      unread,
      // Written only when there IS inbound mail, never written false. That
      // makes it sticky on purpose: the retention sweep deletes message rows
      // without recomputing rollups, so a thread whose inbound half has aged
      // out would otherwise re-derive as "never received anything" and drop
      // out of the Inbox for good.
      ...(newestInbound ? { has_inbound: true } : {}),
      // Outbound mirror of has_inbound, with the same sticky-on-purpose shape:
      // retention can age out the outbound rows, and "the user replied to
      // this" must not silently become false when it does.
      ...(newestOutbound ? { has_outbound: true, last_outbound_at: newestOutbound.date } : {}),
      // Unarchiving is likewise reserved for real arriving mail, so a flag
      // sweep cannot drag an archived-but-unread thread back to the inbox.
      ...(unread && inboundMail ? { archived: false } : {}),
      ...(undelete ? { deleted_at: null } : {}),
      ...(wakeSnooze
        ? { snooze_until: "1970-01-01T00:00:00+00:00", snoozed_at: null, read_later: false }
        : {}),
    })
    .eq("id", threadId);
  // One statement carries every rollup on the thread. Discarding its error let
  // a schema mismatch freeze last_message_at, unread and message_count for
  // every thread at once, silently.
  if (rollupErr) logger.error({ err: rollupErr, threadId }, "thread rollup update failed");
}
