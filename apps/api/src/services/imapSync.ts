import { simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";
import type { ImapFlow } from "imapflow";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { buildImap, findSpecialUse, findSentMailbox, isAuthError } from "./imapClient.js";
import { resolveThread, touchThread } from "./threading.js";
import { bulkSignals, classifyFromSignals } from "./splitClassify.js";

// Per-account sync engine. One AccountSyncer = one long-lived IMAP connection
// that (a) backfills + incrementally ingests INBOX by UID, (b) reconciles
// read/archived state in both directions, and (c) sits in IDLE between cycles
// so new mail lands within seconds. The supervisor in worker.ts owns the
// lifecycle; a syncer that throws schedules its own retry via next_sync_at.

export interface AccountRow {
  id: string;
  owner_id: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  credentials_enc: string;
  auth_method?: string;
  provider_preset: string;
  status: string;
}

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "picture", "source", "h1", "h2", "center", "font"]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    "*": ["style", "align", "width", "height", "cellpadding", "cellspacing", "border", "bgcolor"],
    img: ["src", "srcset", "sizes", "alt", "width", "height", "style"],
    source: ["src", "srcset", "sizes", "media", "type"],
    a: ["href", "name", "target", "rel"],
  },
  // data: images survive; remote http(s) images are left in the HTML for the
  // sandboxed client renderer. cid: sources are resolved through an authed
  // on-demand attachment endpoint rather than exposed as public URLs.
  allowedSchemes: ["http", "https", "mailto", "data", "cid"],
};

// Flag-op pump. The batch is bounded so one cycle always finishes inside the
// 120s deadline in run(); leftovers ride the next cycle 45s later. The TTL is
// how long a claim is trusted before another pass may re-claim it, which is
// what makes a worker dying mid-apply a delay rather than lost data.
const FLAG_OP_BATCH = 500;
const FLAG_OP_CLAIM_TTL_MS = 5 * 60_000;

function toSnippet(text: string | null): string | null {
  if (!text) return null;
  // HTML-only mail (no text part) would otherwise preview as "<!DOCTYPE...".
  // Strip tags/styles down to readable words before truncating.
  const plain = /<[a-z!/]/i.test(text)
    ? text
        .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#\d+;|&[a-z]+;/gi, " ")
    : text;
  return plain.replace(/\s+/g, " ").trim().slice(0, 140) || null;
}

function addrList(v: { value?: { address?: string }[] } | undefined | null): string[] {
  return (v?.value ?? [])
    .map((a) => a.address ?? "")
    .filter(Boolean)
    .map((a) => a.toLowerCase());
}

export class AccountSyncer {
  private client: ImapFlow | null = null;
  private stopped = false;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeResolve: (() => void) | null = null;
  /** A cycle is in flight. Server events fire safeCycle unconditionally, and
   *  the Sent pass selects a second mailbox on this connection: a re-entrant
   *  cycle mid-Sent would run INBOX UID commands against the Sent folder,
   *  marking arbitrary sent mail read or moving it. One cycle at a time. */
  private cycling = false;
  /** Resolved Sent path, cached per connection. */
  private sentPath: string | null = null;
  /** Server has no Sent mailbox at all; stop looking for this run. */
  private sentMissing = false;
  /** Started once per run(); loops until stop() or a connection error. */
  constructor(private account: AccountRow) {}

  get accountId(): string {
    return this.account.id;
  }

  stop(): void {
    this.stopped = true;
    this.wake();
    const c = this.client;
    this.client = null;
    if (c) void c.logout().catch(() => c.close());
  }

  /** Break the idle wait immediately. Used by the dashboard's Sync now
   *  control and by stop(), so neither waits for the 45-second pump. */
  wake(): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    const resolve = this.wakeResolve;
    this.wakeResolve = null;
    resolve?.();
  }

  /** Main loop. Resolves when stopped; schedules backoff + resolves on error. */
  async run(): Promise<void> {
    try {
      this.client = await buildImap(this.account);
      await this.client.connect();
      await this.client.mailboxOpen("INBOX");

      // New-mail push: imapflow idles automatically between commands and emits
      // "exists" when the open mailbox's count changes. Filtered by path
      // because the Sent pass selects a second mailbox on this same
      // connection, and its events must not masquerade as new INBOX mail.
      this.client.on("exists", (info: { path?: string }) => {
        if ((info?.path ?? "INBOX") === "INBOX") void this.safeCycle("new-mail");
      });
      this.client.on("flags", (info: { path?: string }) => {
        if ((info?.path ?? "INBOX") === "INBOX") void this.safeCycle("flags-changed");
      });

      await this.cycle();
      await this.markHealthy();

      // Reconcile + flag-op pump every 45s while idling; reconnect the
      // connection defensively every 25 min (RFC 2177 refresh window).
      const startedAt = Date.now();
      while (!this.stopped && this.client?.usable) {
        await new Promise<void>((resolve) => {
          this.wakeResolve = resolve;
          this.wakeTimer = setTimeout(() => {
            this.wakeTimer = null;
            this.wakeResolve = null;
            resolve();
          }, 45_000);
        });
        if (this.stopped) break;
        // The cycle itself gets a hard deadline. A dead socket can leave a
        // fetch hanging forever, and an await that never resolves means the
        // liveness probe below never runs: Gmail sat wedged for 20+ minutes
        // in exactly this state. Two minutes is generous for an incremental
        // cycle (the full first sync happens before this loop); past that the
        // connection is condemned and rebuilt. The orphaned promise settles
        // when cleanup closes the client.
        const cycled = await Promise.race([
          this.safeCycle("interval").then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 120_000)),
        ]);
        if (!cycled) {
          logger.warn({ accountId: this.account.id }, "sync cycle exceeded deadline; reconnecting");
          break;
        }
        // Zombie check. A connection that dies without a FIN (NAT timeout,
        // Zoho dropping idle sessions) keeps `usable` true forever: the loop
        // spins, cycles fail quietly, and mail stalls until the 25-minute
        // refresh. This happened live: 20 minutes of silence with zero
        // errors recorded. A NOOP with a hard deadline turns that into a
        // break, and the exit path schedules an immediate reconnect.
        const alive = await Promise.race([
          this.client
            .noop()
            .then(() => true)
            .catch(() => false),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
        ]);
        if (!alive) {
          logger.warn({ accountId: this.account.id }, "imap liveness probe failed; reconnecting");
          break;
        }
        if (Date.now() - startedAt > 25 * 60_000) break; // supervisor restarts us
      }
    } catch (err) {
      // handleFailure writes to Supabase and can itself reject (network, RLS,
      // project paused). Swallow that: a bookkeeping failure must never
      // escape run() and become an unhandled rejection.
      try {
        await this.handleFailure(err);
      } catch (bookkeepingErr) {
        logger.error(
          { err: bookkeepingErr, accountId: this.account.id },
          "failed to record sync failure",
        );
      }
    } finally {
      // Everything here is best-effort cleanup. It runs outside the try/catch
      // above, so any throw would reject run() with nothing to catch it.
      try {
        const c = this.client;
        this.client = null;
        if (c) await c.logout().catch(() => c.close());
        if (!this.stopped) {
          // Clean exit (25-min refresh): due immediately so the supervisor
          // reconnects on its next tick.
          await supabase
            .from("email_accounts")
            .update({ next_sync_at: new Date().toISOString() })
            .eq("id", this.account.id)
            .eq("status", "active");
        }
      } catch (cleanupErr) {
        logger.warn({ err: cleanupErr, accountId: this.account.id }, "syncer cleanup failed");
      }
    }
  }

  private async safeCycle(reason: string): Promise<void> {
    try {
      await this.cycle();
    } catch (err) {
      logger.warn({ err, accountId: this.account.id, reason }, "sync cycle failed");
      // Connection-level failures end run() via the usable check / next throw.
    }
  }

  /** One full pass: INBOX work first, then a best-effort Sent pass. */
  private async cycle(): Promise<void> {
    if (this.cycling) return;
    this.cycling = true;
    try {
      await this.cycleInbox();
      if (env.SENT_SYNC_ENABLED === "1" && !this.sentMissing) {
        try {
          await this.cycleSent();
        } catch (err) {
          // Sent is additive: a failure here must not put the account into
          // failure backoff and take INBOX sync down with it.
          logger.warn({ err, accountId: this.account.id }, "sent sync pass failed");
        } finally {
          // IDLE, the flag pump and reconcile all address the SELECTED
          // mailbox, so whatever happened the connection comes home to INBOX.
          const client = this.client;
          if (client?.usable) await client.mailboxOpen("INBOX");
        }
      }
    } finally {
      this.cycling = false;
    }
  }

  /** Ingest new INBOX UIDs, reconcile flags, apply pending flag ops. */
  private async cycleInbox(): Promise<void> {
    const client = this.client;
    if (!client?.usable) throw new Error("imap connection not usable");

    // Self-sufficient rather than trusting the caller's selection: every UID
    // command below addresses whichever mailbox is open, so running this with
    // Sent selected would corrupt the wrong folder.
    let mailbox = client.mailbox;
    if (!mailbox || typeof mailbox === "boolean" || mailbox.path !== "INBOX") {
      await client.mailboxOpen("INBOX");
      mailbox = client.mailbox;
    }
    if (!mailbox || typeof mailbox === "boolean") throw new Error("INBOX not open");

    // ── UIDVALIDITY guard ─────────────────────────────────────────────
    const { data: state } = await supabase
      .from("sync_state")
      .select("uid_validity, last_seen_uid")
      .eq("account_id", this.account.id)
      .eq("mailbox_role", "inbox")
      .maybeSingle();
    const uidValidity = Number(mailbox.uidValidity ?? 0);
    let lastSeenUid = Number(state?.last_seen_uid ?? 0);

    if (!state || Number(state.uid_validity ?? 0) !== uidValidity) {
      if (state && state.uid_validity !== null) {
        // UIDs are meaningless now — wipe and resync this account's window.
        logger.warn({ accountId: this.account.id }, "UIDVALIDITY changed; full resync");
        await supabase.from("messages").delete().eq("account_id", this.account.id);
        await supabase.from("threads").delete().eq("account_id", this.account.id);
      }
      lastSeenUid = 0;
      await supabase.from("sync_state").upsert(
        {
          account_id: this.account.id,
          mailbox: "INBOX",
          mailbox_role: "inbox",
          uid_validity: uidValidity,
          last_seen_uid: 0,
          last_full_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,mailbox_role" },
      );
    }

    // ── Initial backfill cap: only the newest INITIAL_SYNC_LIMIT ──────
    if (lastSeenUid === 0) {
      const uidNext = Number(mailbox.uidNext ?? 1);
      lastSeenUid = Math.max(0, uidNext - 1 - env.INITIAL_SYNC_LIMIT);
    }

    // ── Ingest new messages ───────────────────────────────────────────
    const cutoff = new Date(Date.now() - env.MAIL_RETENTION_DAYS * 24 * 3600 * 1000);
    let maxSeen = lastSeenUid;
    for await (const msg of client.fetch(
      { uid: `${lastSeenUid + 1}:*` },
      { uid: true, flags: true, internalDate: true, source: true },
      { uid: true },
    )) {
      if (msg.uid <= lastSeenUid) continue; // servers may echo the last known
      maxSeen = Math.max(maxSeen, msg.uid);
      if (msg.internalDate && msg.internalDate < cutoff) continue; // outside window
      if (!msg.source) continue;
      await this.ingest(msg.uid, Boolean(msg.flags?.has("\\Seen")), msg.source, msg.internalDate);
    }
    if (maxSeen > lastSeenUid) {
      await supabase
        .from("sync_state")
        .update({
          last_seen_uid: maxSeen,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", this.account.id)
        .eq("mailbox_role", "inbox");
    } else {
      await supabase
        .from("sync_state")
        .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("account_id", this.account.id)
        .eq("mailbox_role", "inbox");
    }

    // Local intent BEFORE remote truth. Reconcile mirrors the server's \Seen
    // flags onto our rows, so running it first reads back the state we have
    // not pushed yet and faithfully reverts the user's own click. "Mark all
    // read" made this obvious: it calls wakeAccount(), so it triggered the
    // very cycle that undid it, seconds later.
    await this.applyFlagOps(client);
    await this.reconcileFlags(client);
  }

  /**
   * Ingest new Sent-mailbox UIDs so threads show both sides of the
   * conversation, including replies sent from other clients (phone, Gmail
   * web). Read-only: the one thing that ever writes to Sent is appendToSent.
   *
   * Mail we sent ourselves was already recorded at send time, so most of what
   * this finds is adopted by Message-ID rather than inserted (see
   * ingestMessage). Everything lands with direction "outbound", which keeps it
   * out of the Inbox: has_inbound decides Inbox membership, and touchThread is
   * called without the ingest-path flag so a sent message can never unarchive
   * or undelete a thread.
   */
  private async cycleSent(): Promise<void> {
    const client = this.client;
    if (!client?.usable) return;

    if (!this.sentPath) {
      this.sentPath = await findSentMailbox(client);
      if (!this.sentPath) {
        this.sentMissing = true;
        logger.info(
          { accountId: this.account.id },
          "server has no Sent mailbox; sent sync disabled for this account",
        );
        return;
      }
    }
    const path = this.sentPath;

    const box = await client.mailboxOpen(path, { readOnly: true });
    const uidValidity = Number(box.uidValidity ?? 0);

    const { data: state } = await supabase
      .from("sync_state")
      .select("uid_validity, last_seen_uid")
      .eq("account_id", this.account.id)
      .eq("mailbox_role", "sent")
      .maybeSingle();
    let lastSeenUid = Number(state?.last_seen_uid ?? 0);

    if (!state || Number(state.uid_validity ?? 0) !== uidValidity) {
      if (state && state.uid_validity !== null) {
        // Sent UIDs are meaningless now. Unlike the INBOX guard this must NOT
        // wipe the account; only the Sent UID bookkeeping is stale. Forget
        // those UIDs and let the rescan re-adopt rows by Message-ID.
        logger.warn({ accountId: this.account.id }, "Sent UIDVALIDITY changed; re-adopting");
        await supabase
          .from("messages")
          .update({ imap_uid: null, imap_mailbox: null })
          .eq("account_id", this.account.id)
          .eq("imap_mailbox", path);
      }
      lastSeenUid = 0;
      await supabase.from("sync_state").upsert(
        {
          account_id: this.account.id,
          mailbox: path,
          mailbox_role: "sent",
          uid_validity: uidValidity,
          last_seen_uid: 0,
          last_full_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,mailbox_role" },
      );
    }

    // First pass reaches back a bounded number of messages, like INBOX's
    // initial cap, so one huge Sent folder cannot eat the cycle deadline.
    if (lastSeenUid === 0) {
      const uidNext = Number(box.uidNext ?? 1);
      lastSeenUid = Math.max(0, uidNext - 1 - env.SENT_INITIAL_SYNC_LIMIT);
    }

    const cutoff = new Date(Date.now() - env.MAIL_RETENTION_DAYS * 24 * 3600 * 1000);
    let maxSeen = lastSeenUid;
    for await (const msg of client.fetch(
      { uid: `${lastSeenUid + 1}:*` },
      { uid: true, internalDate: true, source: true },
      { uid: true },
    )) {
      if (msg.uid <= lastSeenUid) continue;
      maxSeen = Math.max(maxSeen, msg.uid);
      if (msg.internalDate && msg.internalDate < cutoff) continue;
      if (!msg.source) continue;
      // seen=true always: it is the user's own mail.
      await ingestMessage(this.account, msg.uid, true, msg.source, msg.internalDate, {
        mailbox: path,
        direction: "outbound",
      });
    }

    await supabase
      .from("sync_state")
      .update({
        last_seen_uid: maxSeen,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", this.account.id)
      .eq("mailbox_role", "sent");
  }

  /** Parse + store one message, threading it as it lands. */
  private async ingest(uid: number, seen: boolean, source: Buffer, internalDate?: string | Date | null): Promise<void> {
    return ingestMessage(this.account, uid, seen, source, internalDate);
  }
  /** Remote -> local: seen flags and messages that left INBOX (archived). */
  private async reconcileFlags(client: ImapFlow): Promise<void> {
    const { data: local } = await supabase
      .from("messages")
      .select("id, imap_uid, seen, thread_id")
      .eq("account_id", this.account.id)
      .eq("imap_mailbox", "INBOX")
      .not("imap_uid", "is", null);
    if (!local || local.length === 0) return;

    // Anything still queued is intent we have not pushed yet, so the server's
    // flag for it is stale by definition. applyFlagOps runs first and normally
    // drains the queue, but a batch larger than FLAG_OP_BATCH, a failed op, or
    // a click that lands mid-cycle all leave rows behind: mirroring the server
    // over those is precisely the revert the user sees.
    const { data: queued } = await supabase
      .from("flag_ops")
      .select("thread_id, message_id")
      .eq("account_id", this.account.id);
    const heldThreads = new Set((queued ?? []).map((q) => q.thread_id as string).filter(Boolean));
    const heldMessages = new Set((queued ?? []).map((q) => q.message_id as string).filter(Boolean));

    const remote = new Map<number, boolean>(); // uid -> seen
    for await (const msg of client.fetch("1:*", { uid: true, flags: true })) {
      remote.set(msg.uid, Boolean(msg.flags?.has("\\Seen")));
    }

    const touched = new Set<string>();
    for (const row of local) {
      if (heldThreads.has(row.thread_id as string) || heldMessages.has(row.id as string)) continue;
      const uid = Number(row.imap_uid);
      if (!remote.has(uid)) {
        // Gone from INBOX: archived/moved/deleted on the server. Mirror as
        // archived locally (thread level), keep the stored copy.
        const { data: thread } = await supabase
          .from("threads")
          .select("archived")
          .eq("id", row.thread_id)
          .maybeSingle();
        if (thread && !thread.archived) {
          await supabase.from("threads").update({ archived: true }).eq("id", row.thread_id);
        }
        continue;
      }
      const remoteSeen = remote.get(uid)!;
      if (remoteSeen !== row.seen) {
        await supabase.from("messages").update({ seen: remoteSeen }).eq("id", row.id);
        touched.add(row.thread_id as string);
      }
    }
    for (const threadId of touched) await touchThread(threadId);
  }

  /** Local -> remote: replay queued read/archive ops onto the IMAP server. */
  private async applyFlagOps(client: ImapFlow): Promise<void> {
    // Claim-then-act, with three properties the first version lacked and which
    // together lost 2,744 real ops in production:
    //
    //  1. BOUNDED. The old claim was a single unbounded UPDATE: one "mark all
    //     read" over 2,000 threads claimed all 2,000 at once, then walked them
    //     one IMAP round trip at a time. cycle() runs under a 120s deadline
    //     (see run()), so the walk was killed a few dozen ops in, every time.
    //  2. RECLAIMABLE. Because the claim filter was `claimed_at IS NULL`, every
    //     op the killed walk had already claimed became permanently invisible.
    //     A stale claim is now re-claimable, so a worker dying mid-apply costs
    //     a delay rather than the operation.
    //  3. DELETED ONLY ON SUCCESS. The old `finally` deleted the op whatever
    //     happened, so a throw or a no-UID lookup silently discarded the user's
    //     intent and reconcile then flipped the thread back to unread.
    const staleBefore = new Date(Date.now() - FLAG_OP_CLAIM_TTL_MS).toISOString();
    // Two queries rather than one .or(). PostgREST parses an or= filter by
    // splitting on ".", and an ISO timestamp carries one in its milliseconds
    // (…:12.345Z), so `claimed_at.lt.${iso}` is mis-parsed and the whole filter
    // fails. That failure is silent unless the error is read, which is how the
    // first version of this reclaim shipped doing nothing at all: the backlog
    // sat at 2,209 ops through cycle after cycle. Method-arg filters encode
    // their values properly, so .is()/.lt() are safe.
    const [fresh, stale] = await Promise.all([
      supabase
        .from("flag_ops")
        .select("id")
        .eq("account_id", this.account.id)
        .is("claimed_at", null)
        .order("created_at", { ascending: true })
        .limit(FLAG_OP_BATCH),
      supabase
        .from("flag_ops")
        .select("id")
        .eq("account_id", this.account.id)
        .lt("claimed_at", staleBefore)
        .order("created_at", { ascending: true })
        .limit(FLAG_OP_BATCH),
    ]);
    if (fresh.error) logger.warn({ err: fresh.error, accountId: this.account.id }, "flag op claim (fresh) failed");
    if (stale.error) logger.warn({ err: stale.error, accountId: this.account.id }, "flag op claim (stale) failed");

    const ids = [
      ...new Set([...(fresh.data ?? []), ...(stale.data ?? [])].map((r) => r.id as string)),
    ].slice(0, FLAG_OP_BATCH);
    if (ids.length === 0) return;

    const { data: ops, error: claimErr } = await supabase
      .from("flag_ops")
      .update({ claimed_at: new Date().toISOString() })
      .in("id", ids)
      .select("id, op, message_id, thread_id, created_at");
    if (claimErr) logger.warn({ err: claimErr, accountId: this.account.id }, "flag op claim failed");
    if (!ops || ops.length === 0) return;
    logger.info({ accountId: this.account.id, claimed: ops.length }, "flag ops claimed");

    // Read/unread collapse into one IMAP command per batch. Flag changes are
    // set operations, so 500 threads is one messageFlagsAdd over a UID set
    // rather than 500 round trips: the difference between finishing inside the
    // cycle deadline and never finishing at all.
    const bulk = ops.filter((o) => o.op === "read" || o.op === "unread");
    if (bulk.length > 0) await this.applyBulkSeen(client, bulk);

    for (const op of ops.filter((o) => o.op !== "read" && o.op !== "unread")) {
      let ok = true;
      try {
        const uids = await this.uidsFor(op.message_id, op.thread_id, op.created_at as string);
        if (uids.length === 0) {
          // Nothing addressable on the server (never ingested, or already moved
          // out of INBOX). Local state stands; drop the op rather than retry it
          // forever.
          await supabase.from("flag_ops").delete().eq("id", op.id);
          continue;
        }
        const range = uids.join(",");
        if (op.op === "archive") {
          // imapflow's messageMove RESOLVES FALSE rather than throwing: see
          // node_modules/imapflow/lib/commands/move.js, which returns undefined
          // when the mailbox is not SELECTED and false on a tagged NO/BAD. A
          // bare `await` therefore cannot tell a completed move from a refused
          // one, and the old code nulled the UIDs either way.
          //
          // That is unrecoverable, not merely wrong: uidsFor and reconcileFlags
          // both require imap_mailbox='INBOX' with a non-null uid, the ingest
          // upsert keys on (account, mailbox, uid), and backfill only walks
          // below the oldest known uid. A row nulled by a move that never
          // happened can never be re-observed or re-addressed again.
          let moved = false; // a MOVE actually completed
          let attemptedMove = true;
          if (this.account.provider_preset === "gmail") {
            // Gmail: removing from INBOX = archiving (message stays in All Mail).
            moved = Boolean(await client.messageMove({ uid: range }, "[Gmail]/All Mail", { uid: true }));
          } else {
            const archive = await findSpecialUse(client, "\\Archive");
            if (archive) {
              moved = Boolean(await client.messageMove({ uid: range }, archive, { uid: true }));
            } else {
              // No archive folder: best effort is mark-read. The mail stays in
              // INBOX, so its UIDs stay valid and must NOT be forgotten. The
              // thread stays archived in OneInbox regardless.
              await client.messageFlagsAdd({ uid: range }, ["\\Seen"], { uid: true });
              attemptedMove = false;
            }
          }
          if (moved) {
            // Left INBOX: forget the UIDs so reconcile doesn't re-mark the thread.
            await supabase
              .from("messages")
              .update({ imap_mailbox: "archived", imap_uid: null })
              .eq("account_id", this.account.id)
              .in("id", await this.messageIds(op.message_id, op.thread_id, op.created_at as string));
          } else if (attemptedMove) {
            // Refused without throwing. Leave the UIDs intact and retry.
            ok = false;
            logger.warn(
              { opId: op.id, accountId: this.account.id, uids: uids.length },
              "archive move refused by server; keeping uids for retry",
            );
          }
        }
        // unarchive: local-only (pulling mail back into INBOX across servers
        // is unreliable; the thread simply reappears in the unified list).
      } catch (err) {
        ok = false;
        logger.warn({ err, opId: op.id, accountId: this.account.id }, "flag op failed");
      }
      if (ok) {
        await supabase.from("flag_ops").delete().eq("id", op.id);
      } else {
        // Release the claim so the next cycle retries instead of the op being
        // silently swallowed.
        await supabase.from("flag_ops").update({ claimed_at: null }).eq("id", op.id);
      }
    }
  }

  /**
   * Push \Seen for a whole batch of read/unread ops in one command per
   * direction. UIDs are resolved as of each op's created_at so replaying a
   * backlog cannot mark mail read that arrived after the user clicked.
   */
  private async applyBulkSeen(
    client: ImapFlow,
    ops: Array<{ id: string; op: string; message_id: string | null; thread_id: string | null; created_at: string }>,
  ): Promise<void> {
    for (const direction of ["read", "unread"] as const) {
      const group = ops.filter((o) => o.op === direction);
      if (group.length === 0) continue;

      // Track deliverable and undeliverable ops apart. Lumping them together
      // makes the success log count ops whose flag never left the building,
      // which is exactly the kind of false green that hid the original bug.
      const uids = new Set<number>();
      const deliverable: string[] = [];
      const undeliverable: string[] = [];
      for (const op of group) {
        const found = await this.uidsFor(op.message_id, op.thread_id, op.created_at);
        if (found.length === 0) {
          undeliverable.push(op.id);
          continue;
        }
        for (const uid of found) uids.add(uid);
        deliverable.push(op.id);
      }
      if (undeliverable.length > 0) {
        // Not addressable on the server: never ingested, or the thread was
        // archived (which nulls imap_uid) and unarchive is local-only, so the
        // rows can never resolve a UID again. Local state stands; drop them
        // rather than retry forever, but say so.
        logger.info(
          { accountId: this.account.id, op: direction, dropped: undeliverable.length },
          "flag ops undeliverable (no INBOX uid); dropping",
        );
        await supabase.from("flag_ops").delete().in("id", undeliverable);
      }
      if (uids.size === 0) continue;
      const applied = deliverable;

      const range = [...uids].sort((a, b) => a - b).join(",");
      try {
        if (direction === "read") {
          await client.messageFlagsAdd({ uid: range }, ["\\Seen"], { uid: true });
        } else {
          await client.messageFlagsRemove({ uid: range }, ["\\Seen"], { uid: true });
        }
        await supabase.from("flag_ops").delete().in("id", applied);
        logger.info(
          { accountId: this.account.id, op: direction, ops: applied.length, uids: uids.size },
          "flag ops applied",
        );
      } catch (err) {
        logger.warn({ err, accountId: this.account.id, op: direction }, "bulk flag op failed");
        await supabase.from("flag_ops").update({ claimed_at: null }).in("id", applied);
      }
    }
  }

  /**
   * Rows an op covers. `notAfter` must mirror uidsFor: the archive path moves
   * the UIDs uidsFor returned and then forgets the UIDs these ids name, so an
   * unscoped lookup here nulls imap_uid on messages that arrived after the op
   * was queued and were never moved, stranding them exactly as a failed move
   * would.
   */
  private async messageIds(
    messageId: string | null,
    threadId: string | null,
    notAfter?: string | null,
  ): Promise<string[]> {
    if (messageId) return [messageId];
    if (!threadId) return [];
    let query = supabase
      .from("messages")
      .select("id")
      .eq("thread_id", threadId)
      .eq("account_id", this.account.id);
    if (notAfter) query = query.lte("created_at", notAfter);
    const { data } = await query;
    return (data ?? []).map((r) => r.id as string);
  }

  /**
   * UIDs an op should touch. `notAfter` scopes a thread-level op to the
   * messages that existed when the user acted: without it, an op sitting in the
   * queue widens as new mail lands, so replaying a backlog would mark unread
   * mail read that arrived after the click.
   */
  private async uidsFor(
    messageId: string | null,
    threadId: string | null,
    notAfter?: string | null,
  ): Promise<number[]> {
    let query = supabase
      .from("messages")
      .select("imap_uid")
      .eq("account_id", this.account.id)
      .eq("imap_mailbox", "INBOX")
      .not("imap_uid", "is", null);
    if (messageId) query = query.eq("id", messageId);
    else if (threadId) query = query.eq("thread_id", threadId);
    else return [];
    if (notAfter) query = query.lte("created_at", notAfter);
    const { data } = await query;
    return (data ?? []).map((r) => Number(r.imap_uid)).filter((n) => n > 0);
  }

  private async markHealthy(): Promise<void> {
    await supabase
      .from("email_accounts")
      .update({
        consecutive_failures: 0,
        last_error: null,
        // Far-future placeholder while the live connection idles; the run()
        // exit path resets it so the supervisor reconnects promptly.
        next_sync_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      })
      .eq("id", this.account.id);
  }

  private async handleFailure(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    if (isAuthError(err)) {
      logger.warn({ accountId: this.account.id }, "imap auth failed; pausing account");
      // OAuth accounts have no password to update: the refresh token died
      // (revoked, or a 7-day testing-mode expiry), so the fix is a fresh
      // sign-in via the Reconnect button, and the message must say so.
      const oauth = this.account.auth_method === "oauth_google" || this.account.auth_method === "oauth_microsoft";
      await supabase
        .from("email_accounts")
        .update({
          status: "auth_failed",
          last_error: oauth
            ? "Sign-in expired. Open Settings and hit Reconnect to sign in again."
            : "Sign-in failed. Update the password for this account in Settings.",
        })
        .eq("id", this.account.id);
      return;
    }
    const { data } = await supabase
      .from("email_accounts")
      .select("consecutive_failures")
      .eq("id", this.account.id)
      .maybeSingle();
    const failures = Number(data?.consecutive_failures ?? 0) + 1;
    // Capped at 5 minutes, not 60. This is an inbox: a mailbox that is dark
    // for an hour because a flaky provider dropped a few connections in a row
    // is indistinguishable from broken. Auth failures pause the account above
    // and never reach this backoff, so the cap cannot hammer a bad password.
    const delayMin = Math.min(2 ** failures, 5);
    logger.warn(
      { accountId: this.account.id, failures, delayMin, err: message },
      "imap sync failed; backing off",
    );
    await supabase
      .from("email_accounts")
      .update({
        consecutive_failures: failures,
        last_error: message.slice(0, 300),
        next_sync_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
      })
      .eq("id", this.account.id);
  }
}

// ── Supervisor ─────────────────────────────────────────────────────────
const running = new Map<string, AccountSyncer>();

/** One supervisor tick: start due syncers, stop ones that shouldn't run. */
export async function superviseTick(): Promise<void> {
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select(
      "id, owner_id, imap_host, imap_port, imap_username, credentials_enc, provider_preset, auth_method, status, next_sync_at",
    );
  if (error) {
    logger.error({ error }, "supervisor: account list failed");
    return;
  }

  const byId = new Map((accounts ?? []).map((a) => [a.id as string, a]));

  // Tear down syncers for deleted/paused accounts.
  for (const [id, syncer] of running) {
    const row = byId.get(id);
    if (!row || row.status !== "active") {
      syncer.stop();
      running.delete(id);
    }
  }

  // Start due accounts that aren't already running.
  const now = Date.now();
  for (const row of accounts ?? []) {
    if (row.status !== "active") continue;
    if (running.has(row.id as string)) continue;
    if (new Date(row.next_sync_at as string).getTime() > now) continue;
    const syncer = new AccountSyncer(row as never);
    running.set(row.id as string, syncer);
    // run() is fire-and-forget, so it needs its own catch: without one, any
    // rejection escapes as an unhandled rejection.
    void syncer
      .run()
      .catch((err) => logger.error({ err, accountId: row.id }, "syncer run failed"))
      .finally(() => {
        running.delete(row.id as string);
      });
  }
}

/** Nudge an account to sync ASAP (e.g. after the user flips a flag). */
export async function wakeAccount(accountId: string): Promise<void> {
  // A live syncer can break out of IDLE immediately. Otherwise make the
  // account due so the next supervisor tick (30s) starts one.
  const syncer = running.get(accountId);
  if (syncer) {
    syncer.wake();
    return;
  }
  await supabase
    .from("email_accounts")
    .update({ next_sync_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("status", "active");
}

export interface IngestOptions {
  /** IMAP mailbox the message lives in. Defaults to INBOX. */
  mailbox?: string;
  /** Which way the message travelled. Defaults to inbound. */
  direction?: "inbound" | "outbound";
}

/** Parse + store one message against an account, threading it as it lands.
 *  Shared by the live syncer (INBOX and Sent), and the on-demand backfill of
 *  older mail, so all paths produce identical rows and identical threading. */
export async function ingestMessage(
  account: AccountRow,
  uid: number,
  seen: boolean,
  source: Buffer,
  // ImapFlow hands this back as either a Date or a raw string depending on
  // the server, so take both and normalise below.
  internalDate?: string | Date | null,
  opts?: IngestOptions,
): Promise<void> {
    const mailbox = opts?.mailbox ?? "INBOX";
    const direction = opts?.direction ?? "inbound";
    const parsed = await simpleParser(source);
    const messageId = parsed.messageId ?? null;

    // Outbound dedupe-by-adoption. Mail the user sends through OneInbox is
    // recorded locally at send time with no UID, and the same bytes then land
    // in Sent (Gmail auto-saves SMTP sends; we APPEND for everyone else), so
    // the Sent pass re-discovers a message we already hold. Adopt the existing
    // row rather than inserting a twin. Exact string equality is safe here:
    // both nodemailer's generated Message-ID and mailparser's parse of it are
    // angle-bracketed, verified against every outbound row in production.
    if (direction === "outbound" && messageId) {
      const { data: existing } = await supabase
        .from("messages")
        .select("id, imap_uid")
        .eq("account_id", account.id)
        .eq("message_id", messageId)
        .eq("direction", "outbound")
        .limit(1);
      const hit = existing?.[0];
      if (hit) {
        if (hit.imap_uid === null) {
          const { error } = await supabase
            .from("messages")
            .update({ imap_uid: uid, imap_mailbox: mailbox })
            .eq("id", hit.id as string);
          if (error) logger.warn({ error, accountId: account.id, uid }, "outbound adopt failed");
        }
        return;
      }
    }
    const from = parsed.from?.value?.[0];
    const references = Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references
        ? [parsed.references]
        : [];
    const bodyText = parsed.text?.slice(0, 200_000) ?? null;
    const bodyHtml = parsed.html
      ? sanitizeHtml(parsed.html, SANITIZE_OPTS).slice(0, 500_000)
      : null;

    // Split classification, from headers that exist only right now: they are
    // not persisted, so this is the one moment the verdict can be made.
    // headerLines carries lowercased keys and is the reliable PRESENCE check;
    // headers.get() is only for the two headers whose VALUE matters, because
    // mailparser shapes some values into objects rather than strings.
    const headerKeys = new Set((parsed.headerLines ?? []).map((h) => h.key));
    const fromAddrForSignals = (parsed.from?.value?.[0]?.address ?? "unknown").toLowerCase();
    const signals =
      direction === "inbound"
        ? bulkSignals(
            headerKeys,
            (k) => {
              const v = parsed.headers.get(k);
              return v == null ? null : String(v);
            },
            fromAddrForSignals,
          )
        : [];
    const splitClass = classifyFromSignals(signals);
    const snippet = toSnippet(bodyText ?? (parsed.html || null));
    // Fall back to the server's INTERNALDATE (when the message actually landed
    // in the mailbox) before ever reaching for the clock. Plenty of senders
    // emit headers strict parsers reject, and stamping those with "now" buries
    // weeks of real mail under one timestamp at the top of the inbox, then
    // re-dates it again on the next resync. INTERNALDATE is the server's own
    // record of arrival and does not move.
    const arrived = internalDate ? new Date(internalDate) : null;
    const date =
      parsed.date ?? (arrived && !Number.isNaN(arrived.getTime()) ? arrived : new Date());
    const toAddresses = addrList(
      Array.isArray(parsed.to) ? parsed.to[0] : parsed.to,
    );
    const ccAddresses = addrList(
      Array.isArray(parsed.cc) ? parsed.cc[0] : parsed.cc,
    );
    const attachments = (parsed.attachments ?? []).map((a, i) => ({
      filename: a.filename ?? null,
      contentType: a.contentType ?? null,
      contentId: a.contentId?.replace(/^<|>$/g, "") ?? null,
      contentDisposition: a.contentDisposition ?? null,
      related: Boolean(a.related),
      size: a.size ?? 0,
      partId: String(i + 1),
    }));

    const threadId = await resolveThread({
      ownerId: account.owner_id,
      accountId: account.id,
      messageId,
      inReplyTo: parsed.inReplyTo || null,
      referencesIds: references,
      subject: parsed.subject ?? null,
      fromAddress: (from?.address ?? "unknown").toLowerCase(),
      toAddresses,
      date,
      snippet,
      seen,
      direction,
      splitClass,
    });

    const { error } = await supabase.from("messages").upsert(
      {
        owner_id: account.owner_id,
        account_id: account.id,
        thread_id: threadId,
        imap_uid: uid,
        imap_mailbox: mailbox,
        message_id: messageId,
        in_reply_to: parsed.inReplyTo || null,
        references_ids: references,
        from_name: from?.name || null,
        from_address: (from?.address ?? "unknown").toLowerCase(),
        to_addresses: toAddresses,
        cc_addresses: ccAddresses,
        subject: parsed.subject ?? null,
        date: date.toISOString(),
        body_text: bodyText,
        body_html: bodyHtml,
        snippet,
        seen,
        direction,
        attachments,
        bulk_signals: signals,
      },
      { onConflict: "account_id,imap_mailbox,imap_uid" },
    );
    if (error) {
      logger.error({ error, accountId: account.id, uid }, "message upsert failed");
      return;
    }
    // Only INBOUND ingest may pull threads out of trash/archive: that is real
    // mail arriving. A sent message discovered by the Sent pass is the user's
    // own action reflected back and must not resurrect anything.
    await touchThread(threadId, direction === "inbound");

    // The split ratchet: a personal message promotes its whole thread to
    // Important, and nothing ever demotes it back. Same stickiness as
    // has_inbound, same reason: retention deletes message rows without
    // recomputing rollups, so a re-derived verdict can silently lose
    // information. The .neq guard is load-bearing, not cosmetic: threads has
    // replica identity full and sits in supabase_realtime, so an UPDATE that
    // matches a row pushes an event to every open dashboard and invalidates
    // the inbox list under the reader. With .neq an already-important thread
    // matches zero rows, writes no WAL, and fires nothing.
    if (direction === "inbound" && splitClass === "important") {
      await supabase
        .from("threads")
        .update({ split_class: "important" })
        .eq("id", threadId)
        .neq("split_class", "important");
    }
}
