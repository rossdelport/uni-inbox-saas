import { ImapFlow } from "imapflow";
import { decryptCredentials } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { getAccessToken, providerForAuthMethod } from "./oauthTokens.js";

// Thin construction/teardown helpers around ImapFlow. Loggers are hard-off:
// imapflow's debug log would echo the LOGIN command (i.e. the password).

export interface AccountConn {
  id: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  credentials_enc: string;
  provider_preset: string;
  auth_method?: string;
}

export async function buildImap(account: AccountConn, passwordOverride?: string): Promise<ImapFlow> {
  const oauth = providerForAuthMethod(account.auth_method ?? "password");
  const auth =
    oauth && !passwordOverride
      ? {
          user: account.imap_username,
          accessToken: await getAccessToken(account.id, account.auth_method!, account.credentials_enc),
        }
      : {
          user: account.imap_username,
          pass: passwordOverride ?? decryptCredentials(account.credentials_enc).imap_password,
        };
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_port === 993,
    auth,
    logger: false,
    // Fail fast instead of hanging a worker slot on a dead server.
    socketTimeout: 60_000,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  // ImapFlow is an EventEmitter: an async socket error (TLS reset, dropped
  // IDLE connection) with no 'error' listener is an uncaught exception that
  // takes down the whole process. Log it; callers see it via client.usable.
  client.on("error", (err) => {
    logger.warn({ err, accountId: account.id }, "imap connection error");
  });
  return client;
}

/** Run fn with a connected client, always logging out afterwards. */
export async function withImap<T>(
  account: AccountConn,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = await buildImap(account);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// User-triggered mailbox actions tend to arrive in short bursts (delete,
// restore, then permanently delete; or several actions while triaging). A
// fresh TLS + OAuth + IMAP handshake for every click made the safe provider
// confirmation feel sluggish. Keep one short-lived, serialised action
// connection per account so repeat actions reuse the authenticated socket.
//
// This is deliberately separate from AccountSyncer's long-lived IDLE socket:
// routes must also work when API and worker run as separate Railway services,
// and sharing a selected mailbox across concurrent sync/action commands would
// risk applying UIDs to the wrong folder.
const ACTION_IMAP_IDLE_MS = 2 * 60_000;

interface ActionImapSlot {
  client: ImapFlow | null;
  tail: Promise<void>;
  pending: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const actionImapSlots = new Map<string, ActionImapSlot>();

async function closeActionImap(accountId: string, slot: ActionImapSlot): Promise<void> {
  if (actionImapSlots.get(accountId) !== slot || slot.pending > 0) return;
  actionImapSlots.delete(accountId);
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = null;
  const client = slot.client;
  slot.client = null;
  if (client) await client.logout().catch(() => client.close());
}

/**
 * Run a user action over a short-lived reusable IMAP connection.
 *
 * Operations for one account are serialised because IMAP commands address the
 * currently selected mailbox. A failed command drops the socket without
 * retrying the mutation: after an ambiguous network failure, retrying a move
 * or delete automatically could apply the action twice.
 */
export async function withActionImap<T>(
  account: AccountConn,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  let slot = actionImapSlots.get(account.id);
  if (!slot) {
    slot = { client: null, tail: Promise.resolve(), pending: 0, idleTimer: null };
    actionImapSlots.set(account.id, slot);
  }

  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = null;
  slot.pending += 1;

  const previous = slot.tail;
  let release!: () => void;
  slot.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  let client = slot.client;
  try {
    if (!client?.usable) {
      if (client) await client.logout().catch(() => client!.close());
      client = await buildImap(account);
      await client.connect();
      slot.client = client;
    }
    return await fn(client);
  } catch (err) {
    // Do not leave a connection with unknown selected-mailbox/command state in
    // the pool. The next user action gets a clean socket.
    if (slot.client === client) slot.client = null;
    if (client) await client.logout().catch(() => client!.close());
    throw err;
  } finally {
    slot.pending -= 1;
    release();
    if (slot.pending === 0 && actionImapSlots.get(account.id) === slot) {
      slot.idleTimer = setTimeout(() => {
        void closeActionImap(account.id, slot!);
      }, ACTION_IMAP_IDLE_MS);
      slot.idleTimer.unref?.();
    }
  }
}

/** Find a mailbox by special-use flag (e.g. "\\Sent", "\\Archive"). */
export async function findSpecialUse(
  client: ImapFlow,
  use: string,
): Promise<string | null> {
  const boxes = await client.list();
  const hit = boxes.find((b) => b.specialUse === use);
  return hit?.path ?? null;
}

// Servers that predate SPECIAL-USE (RFC 6154) advertise no \Sent flag, so the
// fallback is the handful of names the ecosystem actually uses. Order matters:
// plain "Sent" is the convention Dovecot/Porkbun/Zoho follow, "Sent Items" is
// Outlook's, "Sent Messages" is Apple's.
const SENT_NAMES = ["sent", "sent items", "sent messages", "sent mail", "inbox.sent"];

/** The account's Sent mailbox path, or null when the server simply has none. */
export async function findSentMailbox(client: ImapFlow): Promise<string | null> {
  const boxes = await client.list();
  const special = boxes.find((b) => b.specialUse === "\\Sent");
  if (special) return special.path;
  for (const name of SENT_NAMES) {
    const hit = boxes.find(
      (b) => b.path.toLowerCase() === name || b.name?.toLowerCase() === name,
    );
    if (hit) return hit.path;
  }
  return null;
}

/** True when the error is a credentials problem (vs a transient network one). */
export function isAuthError(err: unknown): boolean {
  const e = err as { authenticationFailed?: boolean; response?: string; message?: string };
  if (e?.authenticationFailed) return true;
  const text = `${e?.response ?? ""} ${e?.message ?? ""}`.toLowerCase();
  return (
    text.includes("authenticationfailed") ||
    text.includes("authentication failed") ||
    text.includes("invalid credentials") ||
    text.includes("username and password not accepted")
  );
}
