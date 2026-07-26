import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { buildImap } from "./imapClient.js";
import { ingestMessage, type AccountRow } from "./imapSync.js";

export interface BackfillResult {
  added: number;
  /** No older mail left to fetch, or the account hit the storage ceiling. */
  exhausted: boolean;
  reason?: "cap_reached" | "no_older_mail" | "not_synced_yet";
}

// Pulls the next block of OLDER mail for one account, on demand, when the
// user scrolls past everything already stored.
//
// This runs on its own short-lived connection rather than waiting for the
// background syncer, which only wakes every 30-45s: far too slow to sit
// behind a scroll. The connection is opened, used and closed immediately, so
// it never joins the pool of long-lived IDLE connections that a mail provider
// counts against its simultaneous-connection limit.
export async function backfillOlder(
  accountId: string,
  ownerId: string,
): Promise<BackfillResult> {
  const { data: account } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!account) throw new Error("account not found");

  // Storage ceiling. Retention keeps the newest N per account, so fetching
  // beyond it would just be deleted by the next sweep.
  const { count } = await supabase
    .from("messages")
    .select("id", { head: true, count: "exact" })
    .eq("account_id", accountId);
  const stored = count ?? 0;
  if (stored >= env.MAIL_RETENTION_MAX_PER_ACCOUNT) {
    return { added: 0, exhausted: true, reason: "cap_reached" };
  }

  const { data: state } = await supabase
    .from("sync_state")
    .select("oldest_seen_uid")
    .eq("account_id", accountId)
    .maybeSingle();

  // Seed the floor from what is stored if the column is still empty.
  let floor = state?.oldest_seen_uid as number | null;
  if (floor === null || floor === undefined) {
    const { data: lowest } = await supabase
      .from("messages")
      .select("imap_uid")
      .eq("account_id", accountId)
      .eq("imap_mailbox", "INBOX")
      .not("imap_uid", "is", null)
      .order("imap_uid", { ascending: true })
      .limit(1)
      .maybeSingle();
    floor = (lowest?.imap_uid as number | null) ?? null;
  }
  if (floor === null) return { added: 0, exhausted: true, reason: "not_synced_yet" };
  if (floor <= 1) return { added: 0, exhausted: true, reason: "no_older_mail" };

  // Never fetch more than the ceiling allows, even if the batch size is bigger.
  const room = env.MAIL_RETENTION_MAX_PER_ACCOUNT - stored;
  const batch = Math.min(env.BACKFILL_BATCH, room);
  const from = Math.max(1, floor - batch);
  const to = floor - 1;

  const client = await buildImap(account as AccountRow);
  // Without this listener an async socket error is an uncaught exception,
  // which would take the whole process down.
  client.on("error", (err) => {
    logger.warn({ err, accountId }, "backfill connection error");
  });

  let added = 0;
  let lowestFetched = floor;
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
    for await (const msg of client.fetch(
      { uid: `${from}:${to}` },
      { uid: true, flags: true, internalDate: true, source: true },
      { uid: true },
    )) {
      if (!msg.source) continue;
      await ingestMessage(
        account as AccountRow,
        msg.uid,
        Boolean(msg.flags?.has("\\Seen")),
        msg.source,
        msg.internalDate,
      );
      added += 1;
      if (msg.uid < lowestFetched) lowestFetched = msg.uid;
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  // Advance the floor to the bottom of the range we asked for, not just the
  // lowest message that came back. Gaps (deleted mail) would otherwise make
  // the next request re-scan the same empty range forever.
  await supabase
    .from("sync_state")
    .update({ oldest_seen_uid: from, updated_at: new Date().toISOString() })
    .eq("account_id", accountId);

  logger.info({ accountId, from, to, added }, "backfilled older mail");
  return {
    added,
    exhausted: from <= 1 || stored + added >= env.MAIL_RETENTION_MAX_PER_ACCOUNT,
  };
}
