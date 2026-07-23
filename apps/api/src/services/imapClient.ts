import { ImapFlow } from "imapflow";
import { decryptCredentials } from "../lib/crypto.js";

// Thin construction/teardown helpers around ImapFlow. Loggers are hard-off:
// imapflow's debug log would echo the LOGIN command (i.e. the password).

export interface AccountConn {
  id: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  credentials_enc: string;
  provider_preset: string;
}

export function buildImap(account: AccountConn, passwordOverride?: string): ImapFlow {
  const password = passwordOverride ?? decryptCredentials(account.credentials_enc).imap_password;
  return new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_port === 993,
    auth: { user: account.imap_username, pass: password },
    logger: false,
    // Fail fast instead of hanging a worker slot on a dead server.
    socketTimeout: 60_000,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
}

/** Run fn with a connected client, always logging out afterwards. */
export async function withImap<T>(
  account: AccountConn,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = buildImap(account);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
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
