import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

// The snooze sweep. NOT what makes snooze work: the inbox read path filters
// snooze_until per request, so a wake time passing makes the thread visible
// on the very next request even if this never runs. The sweep only tidies:
// clear the flags so the thread leaves the Snoozed list, and the resulting
// UPDATE rides the threads Realtime channel, nudging open tabs at the wake
// moment instead of on their next poll.

const SNOOZE_NONE = "1970-01-01T00:00:00+00:00";

export async function snoozeSweep(): Promise<void> {
  const now = new Date().toISOString();
  // BOTH halves of the predicate are load-bearing: without .gt(epoch), every
  // plain read_later row (epoch, also <= now) would look due and the sweep
  // would wipe the user's whole saved list.
  const { data, error } = await supabase
    .from("threads")
    .update({ snooze_until: SNOOZE_NONE, snoozed_at: null, read_later: false })
    .gt("snooze_until", SNOOZE_NONE)
    .lte("snooze_until", now)
    .select("id");
  if (error) {
    logger.warn({ err: error }, "snooze sweep failed");
    return;
  }
  if ((data ?? []).length > 0) {
    logger.info({ woken: data!.length }, "snoozed threads returned to inbox");
  }
}
