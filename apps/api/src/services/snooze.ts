import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

// The snooze sweep. NOT what makes snooze work: the inbox read path filters
// snooze_until per request, so a wake time passing makes the thread visible
// on the very next request even if this never runs. The sweep tidies the
// filing flags and deliberately wakes the thread as unread. That unread state
// drives the sidebar/tab count, while the flag op mirrors it to the mailbox so
// the next IMAP reconcile cannot silently turn it straight back to read.

const SNOOZE_NONE = "1970-01-01T00:00:00+00:00";

export async function snoozeSweep(): Promise<void> {
  const now = new Date().toISOString();
  // BOTH halves of the predicate are load-bearing: without .gt(epoch), every
  // plain read_later row (epoch, also <= now) would look due and the sweep
  // would wipe the user's whole saved list.
  const { data, error } = await supabase
    .from("threads")
    .update({
      snooze_until: SNOOZE_NONE,
      snoozed_at: null,
      snooze_woke_at: now,
      read_later: false,
      unread: true,
    })
    .gt("snooze_until", SNOOZE_NONE)
    .lte("snooze_until", now)
    .select("id, account_id");
  if (error) {
    logger.warn({ err: error }, "snooze sweep failed");
    return;
  }
  const waking = data ?? [];
  if (waking.length === 0) return;

  const threadIds = waking.map((thread) => thread.id as string);
  // Keep the local message flags aligned with the thread rollup. Otherwise a
  // normal IMAP reconcile can recalculate `unread` from the still-seen
  // messages and erase the wake-up before the user sees it.
  const { error: messageError } = await supabase
    .from("messages")
    .update({ seen: false })
    .in("thread_id", threadIds)
    .eq("direction", "inbound");
  if (messageError) {
    logger.warn({ err: messageError, threads: threadIds.length }, "snooze wake message flags failed");
  }

  // The worker replays this existing flag-op vocabulary to IMAP. Snooze itself
  // remains a OneInbox-only filing action; only the wake-up unread state is
  // mirrored so the mailbox and the browser agree after the next reconcile.
  const { error: flagError } = await supabase.from("flag_ops").insert(
    waking.map((thread) => ({
      account_id: thread.account_id as string,
      thread_id: thread.id as string,
      op: "unread",
    })),
  );
  if (flagError) {
    logger.warn({ err: flagError, threads: threadIds.length }, "snooze wake unread ops failed");
  }

  logger.info({ woken: waking.length }, "snoozed threads returned to inbox as unread");
}
