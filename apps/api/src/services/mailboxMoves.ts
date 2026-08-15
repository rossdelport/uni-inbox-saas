import { randomUUID } from "node:crypto";
import type { ImapFlow } from "imapflow";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { findSentMailbox, findSpecialUse, withActionImap } from "./imapClient.js";

export type MailboxDestination = "trash" | "inbox";

export class RemoteMailboxMoveError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = "RemoteMailboxMoveError";
    this.statusCode = statusCode;
  }
}

interface MessageLocation {
  id: string;
  imap_uid: number | string | null;
  imap_mailbox: string | null;
  message_id: string | null;
}

interface MoveJob {
  id: string;
  owner_id: string;
  account_id: string;
  thread_id: string;
  destination: MailboxDestination;
  generation: string;
  status: "queued" | "processing";
  attempts: number;
  claimed_at: string | null;
}

// Resolve once per account/process and reuse it for future actions. The Gmail
// fallback is only used when SPECIAL-USE is absent: Gmail folder names can be
// localised, so discovery remains the first choice.
const trashMailboxCache = new Map<string, string>();

async function trashMailboxFor(
  account: { id: string; provider_preset: string },
  client: ImapFlow,
): Promise<string | null> {
  const cached = trashMailboxCache.get(account.id);
  if (cached) return cached;
  const found = (await findSpecialUse(client, "\\Trash"))
    ?? (account.provider_preset === "gmail" ? "[Gmail]/Trash" : null);
  if (found) trashMailboxCache.set(account.id, found);
  return found;
}

async function findMessageUid(
  client: ImapFlow,
  mailbox: string,
  messageId: string | null,
): Promise<number | null> {
  if (!messageId?.trim()) return null;
  await client.mailboxOpen(mailbox, { readOnly: false });
  const found = await client.search(
    { header: { "Message-ID": messageId.trim() } },
    { uid: true },
  );
  const uid = Array.isArray(found) ? found[0] : undefined;
  return typeof uid === "number" && Number.isSafeInteger(uid) && uid > 0 ? uid : null;
}

async function updateMessageLocation(
  ownerId: string,
  messageId: string,
  mailbox: string,
  uid: number | null,
): Promise<void> {
  const first = await supabase
    .from("messages")
    .update({ imap_mailbox: mailbox, imap_uid: uid })
    .eq("id", messageId)
    .eq("owner_id", ownerId);
  if (!first.error) return;

  // A thread can briefly contain both an optimistic outbound row and the Sent
  // copy later adopted from IMAP. If they resolve to the same provider UID,
  // keep this duplicate addressable by mailbox but leave its UID null rather
  // than violating the unique mailbox mapping.
  if (first.error.code === "23505") {
    const fallback = await supabase
      .from("messages")
      .update({ imap_mailbox: mailbox, imap_uid: null })
      .eq("id", messageId)
      .eq("owner_id", ownerId);
    if (!fallback.error) return;
  }
  throw new RemoteMailboxMoveError(
    "The message moved, but OneInbox could not update its mailbox record.",
    502,
  );
}

async function moveOneMessage(
  client: ImapFlow,
  ownerId: string,
  row: MessageLocation,
  source: string,
  destination: string,
  uid: number,
): Promise<void> {
  await client.mailboxOpen(source, { readOnly: false });
  let moved;
  if (client.capabilities.has("MOVE")) {
    moved = await client.messageMove(uid, destination, { uid: true });
  } else if (client.capabilities.has("UIDPLUS")) {
    const copied = await client.messageCopy(uid, destination, { uid: true });
    if (!copied) {
      throw new RemoteMailboxMoveError("The mail server refused to copy this conversation.", 502);
    }
    const expunged = await client.messageDelete(uid, { uid: true });
    if (!expunged) {
      throw new RemoteMailboxMoveError(
        "The mail server copied the conversation but refused to remove the original.",
        502,
      );
    }
    moved = copied;
  } else {
    throw new RemoteMailboxMoveError("This mailbox cannot safely move one conversation at a time.");
  }

  if (!moved) {
    // A retry may encounter a move that the provider completed just before a
    // socket dropped. Prove it is already at the destination before deciding
    // that this attempt failed.
    const alreadyThere = await findMessageUid(client, destination, row.message_id);
    if (alreadyThere) {
      await updateMessageLocation(ownerId, row.id, destination, alreadyThere);
      return;
    }
    throw new RemoteMailboxMoveError("The mail server refused to move this conversation.", 502);
  }

  const uidMap = typeof moved === "object" ? moved.uidMap : undefined;
  await updateMessageLocation(ownerId, row.id, destination, uidMap?.get(uid) ?? null);
}

/**
 * Move every server-backed message in a thread to Trash, or move only its
 * Trash copies back to Inbox. The latter deliberately leaves Sent copies in
 * Sent rather than turning the user's own replies into Inbox messages.
 *
 * Missing UIDs are recovered by Message-ID. That matters after providers omit
 * COPYUID from a completed move: the old synchronous route treated the null as
 * a hard error, which made Restore appear to fail even though Gmail was still
 * finishing the first move.
 */
export async function moveThreadMailbox(
  ownerId: string,
  threadId: string,
  destinationKind: MailboxDestination,
): Promise<void> {
  const [threadResult, messagesResult] = await Promise.all([
    supabase
      .from("threads")
      .select("account_id")
      .eq("id", threadId)
      .eq("owner_id", ownerId)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("id, imap_uid, imap_mailbox, message_id")
      .eq("thread_id", threadId)
      .eq("owner_id", ownerId),
  ]);
  const { data: thread, error: threadError } = threadResult;
  if (threadError) throw new RemoteMailboxMoveError("Could not prepare the mailbox move.", 502);
  if (!thread) throw new RemoteMailboxMoveError("Thread not found.", 404);
  if (messagesResult.error) {
    throw new RemoteMailboxMoveError("Could not prepare the mailbox move.", 502);
  }

  const { data: account, error: accountError } = await supabase
    .from("email_accounts")
    .select("id, imap_host, imap_port, imap_username, credentials_enc, provider_preset, auth_method")
    .eq("id", thread.account_id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (accountError) throw new RemoteMailboxMoveError("Could not prepare the mailbox move.", 502);
  if (!account) throw new RemoteMailboxMoveError("Mailbox not found.", 404);

  const rows = (messagesResult.data ?? []) as MessageLocation[];
  await withActionImap(account, async (client) => {
    const trash = await trashMailboxFor(account, client);
    if (!trash) {
      throw new RemoteMailboxMoveError("This mailbox does not expose a Trash folder.");
    }
    const destination = destinationKind === "inbox" ? "INBOX" : trash;
    const sent = await findSentMailbox(client);
    const archive = (await findSpecialUse(client, "\\Archive"))
      ?? (account.provider_preset === "gmail" ? "[Gmail]/All Mail" : null);
    const available = new Set((await client.list()).map((box) => box.path));

    // Avoid moving the same provider message twice when a local optimistic
    // outbound row and a later Sent-sync row share one RFC Message-ID.
    const movedProviderRows = new Set<string>();
    for (const row of rows) {
      let source = row.imap_mailbox;
      if (source === "archived") source = archive;

      if (destinationKind === "inbox") {
        // Restore only what is actually in Trash. Sent copies stay in Sent;
        // existing Inbox copies are already where the user asked for them.
        if (source && source !== trash) continue;
        source = trash;
      }

      if (source === destination) continue;

      const candidates = destinationKind === "inbox"
        ? [trash]
        : [source, "INBOX", sent, archive].filter((v): v is string => Boolean(v));
      let locatedSource: string | null = source && available.has(source) ? source : null;
      let uid = locatedSource === row.imap_mailbox ? Number(row.imap_uid) : Number.NaN;
      if (!Number.isSafeInteger(uid) || uid <= 0) {
        uid = Number.NaN;
        for (const candidate of [...new Set(candidates)]) {
          if (!available.has(candidate)) continue;
          const found = await findMessageUid(client, candidate, row.message_id);
          if (found) {
            locatedSource = candidate;
            uid = found;
            break;
          }
        }
      }

      if (!locatedSource || !Number.isSafeInteger(uid) || uid <= 0) {
        const atDestination = available.has(destination)
          ? await findMessageUid(client, destination, row.message_id)
          : null;
        if (atDestination) {
          await updateMessageLocation(ownerId, row.id, destination, atDestination);
        } else {
          // Local-only rows (or already-expunged duplicates) have no provider
          // copy to move. They must not block the rest of the conversation.
          logger.info({ threadId, messageId: row.id }, "mailbox move skipped unaddressable local row");
        }
        continue;
      }

      const providerKey = `${locatedSource}:${uid}`;
      if (movedProviderRows.has(providerKey)) {
        await updateMessageLocation(ownerId, row.id, destination, null);
        continue;
      }
      movedProviderRows.add(providerKey);
      await moveOneMessage(client, ownerId, row, locatedSource, destination, uid);
    }
  });
}

/** Store the latest desired mailbox location. A generation token makes rapid
 * delete/restore toggles safe: an older in-flight job cannot delete a newer
 * request when it finishes. */
export async function enqueueMailboxMove(args: {
  ownerId: string;
  accountId: string;
  threadId: string;
  destination: MailboxDestination;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("mailbox_move_ops").upsert(
    {
      owner_id: args.ownerId,
      account_id: args.accountId,
      thread_id: args.threadId,
      destination: args.destination,
      generation: randomUUID(),
      status: "queued",
      attempts: 0,
      not_before: now,
      claimed_at: null,
      last_error: null,
      updated_at: now,
    },
    { onConflict: "thread_id" },
  );
  if (error) {
    logger.error({ err: error, threadId: args.threadId }, "mailbox move enqueue failed");
    throw new RemoteMailboxMoveError("Could not queue the mailbox move.", 502);
  }
  void kickMailboxMoveDrain().catch((err) =>
    logger.error({ err, threadId: args.threadId }, "immediate mailbox move drain failed"),
  );
}

const CLAIM_STALE_MS = 2 * 60_000;
const MOVE_BATCH = 10;
let activeDrain: Promise<void> | null = null;

async function processMoveJob(candidate: MoveJob): Promise<void> {
  const now = new Date().toISOString();
  const attempts = Number(candidate.attempts ?? 0) + 1;
  const { data: job, error: claimError } = await supabase
    .from("mailbox_move_ops")
    .update({ status: "processing", claimed_at: now, attempts, updated_at: now })
    .eq("id", candidate.id)
    .eq("generation", candidate.generation)
    .eq("status", candidate.status)
    .select("id, owner_id, account_id, thread_id, destination, generation, status, attempts, claimed_at")
    .maybeSingle();
  if (claimError) {
    logger.warn({ err: claimError, jobId: candidate.id }, "mailbox move claim failed");
    return;
  }
  if (!job) return;

  try {
    await moveThreadMailbox(job.owner_id as string, job.thread_id as string, job.destination as MailboxDestination);
    await supabase
      .from("mailbox_move_ops")
      .delete()
      .eq("id", job.id)
      .eq("generation", job.generation);
    logger.info(
      { threadId: job.thread_id, destination: job.destination, attempts },
      "mailbox move completed",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown mailbox move error";
    // Keep retrying durably. The local pile already reflects the user's last
    // click, so a temporary provider delay never makes the row flash back.
    const delayMs = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempts - 1, 8));
    const retryAt = new Date(Date.now() + delayMs).toISOString();
    await supabase
      .from("mailbox_move_ops")
      .update({
        status: "queued",
        claimed_at: null,
        not_before: retryAt,
        last_error: message.slice(0, 1_000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("generation", job.generation);
    logger.warn(
      { err, threadId: job.thread_id, destination: job.destination, attempts, retryAt },
      "mailbox move deferred for retry",
    );
  }
}

async function runMailboxMoveDrain(): Promise<void> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const [queued, stale] = await Promise.all([
    supabase
      .from("mailbox_move_ops")
      .select("id, owner_id, account_id, thread_id, destination, generation, status, attempts, claimed_at")
      .eq("status", "queued")
      .lte("not_before", now)
      .order("created_at", { ascending: true })
      .limit(MOVE_BATCH),
    supabase
      .from("mailbox_move_ops")
      .select("id, owner_id, account_id, thread_id, destination, generation, status, attempts, claimed_at")
      .eq("status", "processing")
      .lt("claimed_at", staleBefore)
      .order("created_at", { ascending: true })
      .limit(MOVE_BATCH),
  ]);
  if (queued.error) logger.warn({ err: queued.error }, "queued mailbox move lookup failed");
  if (stale.error) logger.warn({ err: stale.error }, "stale mailbox move lookup failed");

  const jobs = [...new Map(
    [...((queued.data ?? []) as MoveJob[]), ...((stale.data ?? []) as MoveJob[])]
      .map((job) => [job.id, job]),
  ).values()].slice(0, MOVE_BATCH);
  await Promise.all(jobs.map(processMoveJob));
}

export function kickMailboxMoveDrain(): Promise<void> {
  if (activeDrain) return activeDrain;
  activeDrain = runMailboxMoveDrain().finally(() => {
    activeDrain = null;
  });
  return activeDrain;
}
