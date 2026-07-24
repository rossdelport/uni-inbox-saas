import { simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";
import type { ImapFlow } from "imapflow";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { buildImap, findSpecialUse, isAuthError } from "./imapClient.js";
import { resolveThread, touchThread } from "./threading.js";

// Per-account sync engine. One AccountSyncer = one long-lived IMAP connection
// that (a) backfills + incrementally ingests INBOX by UID, (b) reconciles
// read/archived state in both directions, and (c) sits in IDLE between cycles
// so new mail lands within seconds. The supervisor in worker.ts owns the
// lifecycle; a syncer that throws schedules its own retry via next_sync_at.

interface AccountRow {
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
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "center", "font"]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    "*": ["style", "align", "width", "height", "cellpadding", "cellspacing", "border", "bgcolor"],
    img: ["src", "alt", "width", "height", "style"],
    a: ["href", "name", "target", "rel"],
  },
  // data: images survive; remote http(s) images are left in the HTML and the
  // CLIENT blocks them by default (privacy toggle in the thread view).
  allowedSchemes: ["http", "https", "mailto", "data", "cid"],
};

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
  /** Started once per run(); loops until stop() or a connection error. */
  constructor(private account: AccountRow) {}

  get accountId(): string {
    return this.account.id;
  }

  stop(): void {
    this.stopped = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    const c = this.client;
    this.client = null;
    if (c) void c.logout().catch(() => c.close());
  }

  /** Main loop. Resolves when stopped; schedules backoff + resolves on error. */
  async run(): Promise<void> {
    try {
      this.client = await buildImap(this.account);
      await this.client.connect();
      await this.client.mailboxOpen("INBOX");

      // New-mail push: imapflow idles automatically between commands and emits
      // "exists" when the INBOX count changes.
      this.client.on("exists", () => void this.safeCycle("new-mail"));
      this.client.on("flags", () => void this.safeCycle("flags-changed"));

      await this.cycle();
      await this.markHealthy();

      // Reconcile + flag-op pump every 45s while idling; reconnect the
      // connection defensively every 25 min (RFC 2177 refresh window).
      const startedAt = Date.now();
      while (!this.stopped && this.client?.usable) {
        await new Promise<void>((resolve) => {
          this.wakeTimer = setTimeout(resolve, 45_000);
        });
        if (this.stopped) break;
        await this.safeCycle("interval");
        if (Date.now() - startedAt > 25 * 60_000) break; // supervisor restarts us
      }
    } catch (err) {
      await this.handleFailure(err);
    } finally {
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

  /** One full pass: ingest new UIDs, reconcile flags, apply pending flag ops. */
  private async cycle(): Promise<void> {
    const client = this.client;
    if (!client?.usable) throw new Error("imap connection not usable");

    const mailbox = client.mailbox;
    if (!mailbox || typeof mailbox === "boolean") throw new Error("INBOX not open");

    // ── UIDVALIDITY guard ─────────────────────────────────────────────
    const { data: state } = await supabase
      .from("sync_state")
      .select("uid_validity, last_seen_uid")
      .eq("account_id", this.account.id)
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
      await supabase.from("sync_state").upsert({
        account_id: this.account.id,
        mailbox: "INBOX",
        uid_validity: uidValidity,
        last_seen_uid: 0,
        last_full_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
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
      await this.ingest(msg.uid, Boolean(msg.flags?.has("\\Seen")), msg.source);
    }
    if (maxSeen > lastSeenUid) {
      await supabase
        .from("sync_state")
        .update({
          last_seen_uid: maxSeen,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", this.account.id);
    } else {
      await supabase
        .from("sync_state")
        .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("account_id", this.account.id);
    }

    await this.reconcileFlags(client);
    await this.applyFlagOps(client);
  }

  /** Parse + store one message, threading it as it lands. */
  private async ingest(uid: number, seen: boolean, source: Buffer): Promise<void> {
    const parsed = await simpleParser(source);
    const messageId = parsed.messageId ?? null;
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
    const snippet = toSnippet(bodyText ?? (parsed.html || null));
    const date = parsed.date ?? new Date();
    const toAddresses = addrList(
      Array.isArray(parsed.to) ? parsed.to[0] : parsed.to,
    );
    const ccAddresses = addrList(
      Array.isArray(parsed.cc) ? parsed.cc[0] : parsed.cc,
    );
    const attachments = (parsed.attachments ?? []).map((a, i) => ({
      filename: a.filename ?? null,
      contentType: a.contentType ?? null,
      size: a.size ?? 0,
      partId: String(i + 1),
    }));

    const threadId = await resolveThread({
      ownerId: this.account.owner_id,
      accountId: this.account.id,
      messageId,
      inReplyTo: parsed.inReplyTo || null,
      referencesIds: references,
      subject: parsed.subject ?? null,
      fromAddress: (from?.address ?? "unknown").toLowerCase(),
      toAddresses,
      date,
      snippet,
      seen,
    });

    const { error } = await supabase.from("messages").upsert(
      {
        owner_id: this.account.owner_id,
        account_id: this.account.id,
        thread_id: threadId,
        imap_uid: uid,
        imap_mailbox: "INBOX",
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
        direction: "inbound",
        attachments,
      },
      { onConflict: "account_id,imap_mailbox,imap_uid" },
    );
    if (error) {
      logger.error({ error, accountId: this.account.id, uid }, "message upsert failed");
      return;
    }
    await touchThread(threadId);
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

    const remote = new Map<number, boolean>(); // uid -> seen
    for await (const msg of client.fetch("1:*", { uid: true, flags: true })) {
      remote.set(msg.uid, Boolean(msg.flags?.has("\\Seen")));
    }

    const touched = new Set<string>();
    for (const row of local) {
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
    // Claim-then-act: flips claimed_at so a second worker never replays the
    // same op, even if this process dies mid-apply.
    const { data: ops } = await supabase
      .from("flag_ops")
      .update({ claimed_at: new Date().toISOString() })
      .eq("account_id", this.account.id)
      .is("claimed_at", null)
      .select("id, op, message_id, thread_id");
    if (!ops || ops.length === 0) return;

    for (const op of ops) {
      try {
        const uids = await this.uidsFor(op.message_id, op.thread_id);
        if (uids.length === 0) continue;
        const range = uids.join(",");
        if (op.op === "read") {
          await client.messageFlagsAdd({ uid: range }, ["\\Seen"], { uid: true });
        } else if (op.op === "unread") {
          await client.messageFlagsRemove({ uid: range }, ["\\Seen"], { uid: true });
        } else if (op.op === "archive") {
          if (this.account.provider_preset === "gmail") {
            // Gmail: removing from INBOX = archiving (message stays in All Mail).
            await client.messageMove({ uid: range }, "[Gmail]/All Mail", { uid: true });
          } else {
            const archive = await findSpecialUse(client, "\\Archive");
            if (archive) {
              await client.messageMove({ uid: range }, archive, { uid: true });
            } else {
              // No archive folder: best effort is mark-read; the thread stays
              // archived in OneInbox regardless.
              await client.messageFlagsAdd({ uid: range }, ["\\Seen"], { uid: true });
            }
          }
          // Moved messages leave INBOX: forget their UIDs so reconcile doesn't
          // re-mark the thread.
          await supabase
            .from("messages")
            .update({ imap_mailbox: "archived", imap_uid: null })
            .eq("account_id", this.account.id)
            .in("id", await this.messageIds(op.message_id, op.thread_id));
        }
        // unarchive: local-only (pulling mail back into INBOX across servers
        // is unreliable; the thread simply reappears in the unified list).
      } catch (err) {
        logger.warn({ err, opId: op.id, accountId: this.account.id }, "flag op failed");
      } finally {
        await supabase.from("flag_ops").delete().eq("id", op.id);
      }
    }
  }

  private async messageIds(messageId: string | null, threadId: string | null): Promise<string[]> {
    if (messageId) return [messageId];
    if (!threadId) return [];
    const { data } = await supabase
      .from("messages")
      .select("id")
      .eq("thread_id", threadId)
      .eq("account_id", this.account.id);
    return (data ?? []).map((r) => r.id as string);
  }

  private async uidsFor(messageId: string | null, threadId: string | null): Promise<number[]> {
    let query = supabase
      .from("messages")
      .select("imap_uid")
      .eq("account_id", this.account.id)
      .eq("imap_mailbox", "INBOX")
      .not("imap_uid", "is", null);
    if (messageId) query = query.eq("id", messageId);
    else if (threadId) query = query.eq("thread_id", threadId);
    else return [];
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
      await supabase
        .from("email_accounts")
        .update({
          status: "auth_failed",
          last_error: "Sign-in failed. Update the password for this account in Settings.",
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
    const delayMin = Math.min(2 ** failures, 60);
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
    void syncer.run().finally(() => {
      running.delete(row.id as string);
    });
  }
}

/** Nudge an account to sync ASAP (e.g. after the user flips a flag). */
export async function wakeAccount(accountId: string): Promise<void> {
  // If a syncer is live its 45s interval picks the op up; otherwise make the
  // account due so the next supervisor tick (30s) starts one.
  if (running.has(accountId)) return;
  await supabase
    .from("email_accounts")
    .update({ next_sync_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("status", "active");
}
