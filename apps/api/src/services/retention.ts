import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

// Storage-lean retention: OneInbox is a recent-mail window, not an archive.
// Keep messages that are BOTH within the day window and the newest N per
// account is too strict; we keep whichever is more generous per message:
// inside MAIL_RETENTION_DAYS *or* among the newest MAX_PER_ACCOUNT. The sweep
// deletes what fails both, then removes threads left empty.

export async function retentionSweep(): Promise<void> {
  // Trash purge: threads deleted more than 30 days ago go for good
  // (their messages cascade with the thread row).
  const trashCutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data: purged, error: purgeErr } = await supabase
    .from("threads")
    .delete()
    .lt("deleted_at", trashCutoff)
    .select("id");
  if (purgeErr) logger.warn({ purgeErr }, "trash purge failed");
  else if ((purged ?? []).length > 0) logger.info({ purged: purged?.length }, "trash purged");

  const cutoff = new Date(
    Date.now() - env.MAIL_RETENTION_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  const { data: accounts } = await supabase.from("email_accounts").select("id");
  for (const account of accounts ?? []) {
    // Newest N message ids for this account (kept regardless of age).
    const { data: keep } = await supabase
      .from("messages")
      .select("id")
      .eq("account_id", account.id)
      .order("date", { ascending: false })
      .limit(env.MAIL_RETENTION_MAX_PER_ACCOUNT);
    const keepIds = new Set((keep ?? []).map((r) => r.id as string));

    const { data: oldOnes } = await supabase
      .from("messages")
      .select("id")
      .eq("account_id", account.id)
      .lt("date", cutoff);
    const doomed = (oldOnes ?? [])
      .map((r) => r.id as string)
      .filter((id) => !keepIds.has(id));
    if (doomed.length === 0) continue;

    for (let i = 0; i < doomed.length; i += 100) {
      await supabase.from("messages").delete().in("id", doomed.slice(i, i + 100));
    }
    logger.info({ accountId: account.id, deleted: doomed.length }, "retention sweep");
  }

  // Threads with no remaining messages disappear from the inbox.
  const { data: emptyThreads } = await supabase.rpc("delete_empty_threads");
  if (emptyThreads !== null && emptyThreads !== undefined) {
    logger.info({ emptyThreads }, "empty threads removed");
  }
}
