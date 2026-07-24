import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { decryptCredentials } from "../lib/crypto.js";

// XOAUTH2 token plumbing for Google and Microsoft mail access. We store only
// the (encrypted) refresh token; short-lived access tokens live in memory and
// refresh on demand. A dead refresh token surfaces as an auth failure so the
// account flips to auth_failed like a wrong password would.

export type OauthProvider = "google" | "microsoft";

interface ProviderConf {
  tokenUrl: string;
  authUrl: string;
  scope: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  imap: { host: string; port: number };
  smtp: { host: string; port: number; security: "tls" | "starttls" };
  presetId: "gmail" | "outlook";
  label: string;
}

export const OAUTH_PROVIDERS: Record<OauthProvider, ProviderConf> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email https://mail.google.com/",
    clientId: () => env.GOOGLE_CLIENT_ID,
    clientSecret: () => env.GOOGLE_CLIENT_SECRET,
    imap: { host: "imap.gmail.com", port: 993 },
    smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
    presetId: "gmail",
    label: "Gmail",
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope:
      "openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send",
    clientId: () => env.MS_CLIENT_ID,
    clientSecret: () => env.MS_CLIENT_SECRET,
    imap: { host: "outlook.office365.com", port: 993 },
    smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
    presetId: "outlook",
    label: "Outlook",
  },
};

export function providerForAuthMethod(method: string): OauthProvider | null {
  if (method === "oauth_google") return "google";
  if (method === "oauth_microsoft") return "microsoft";
  return null;
}

export function oauthConfigured(provider: OauthProvider): boolean {
  const c = OAUTH_PROVIDERS[provider];
  return Boolean(c.clientId() && c.clientSecret());
}

/** The app's public origin (redirect URIs live under it). */
export function appOrigin(): string {
  return env.DASHBOARD_URL.replace(/\/app\/?$/, "");
}

// ---- signed state for the authorize round-trip ----
const STATE_KEY = Buffer.from(env.CREDENTIALS_KEY, "base64");

export function signState(uid: string, provider: OauthProvider): string {
  const payload = Buffer.from(
    JSON.stringify({ uid, provider, ts: Date.now(), n: randomBytes(8).toString("hex") }),
    "utf8",
  ).toString("base64url");
  const mac = createHmac("sha256", STATE_KEY).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyState(state: string): { uid: string; provider: OauthProvider } | null {
  const [payload, mac] = state.split(".");
  if (!payload || !mac) return null;
  const expect = createHmac("sha256", STATE_KEY).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      uid: string;
      provider: OauthProvider;
      ts: number;
    };
    if (Date.now() - data.ts > 15 * 60_000) return null; // stale
    if (data.provider !== "google" && data.provider !== "microsoft") return null;
    return { uid: data.uid, provider: data.provider };
  } catch {
    return null;
  }
}

// ---- token exchange + refresh ----
export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

export async function exchangeCode(provider: OauthProvider, code: string): Promise<TokenSet> {
  const c = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: c.clientId() ?? "",
    client_secret: c.clientSecret() ?? "",
    redirect_uri: `${appOrigin()}/api/oauth/${provider}/callback`,
  });
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    logger.error({ provider, status: res.status, body: text.slice(0, 300) }, "oauth code exchange failed");
    throw new Error(`OAuth exchange failed (${res.status})`);
  }
  return (await res.json()) as TokenSet;
}

/** Pull the email address out of an id_token (JWT from the token endpoint
 *  over TLS, so decoding without signature verification is fine here). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      preferred_username?: string;
    };
    const email = claims.email ?? claims.preferred_username ?? null;
    return email && email.includes("@") ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Access-token cache: accountId -> { token, exp }
const cache = new Map<string, { token: string; exp: number }>();

export function dropCachedToken(accountId: string) {
  cache.delete(accountId);
}

export async function getAccessToken(
  accountId: string,
  authMethod: string,
  credentialsEnc: string,
): Promise<string> {
  const provider = providerForAuthMethod(authMethod);
  if (!provider) throw new Error("account is not OAuth-connected");
  const hit = cache.get(accountId);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;

  const { refresh_token } = decryptCredentials(credentialsEnc) as { refresh_token?: string };
  if (!refresh_token) throw new Error("authentication failed: no refresh token on file");

  const c = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: c.clientId() ?? "",
    client_secret: c.clientSecret() ?? "",
  });
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    const revoked = text.includes("invalid_grant");
    logger.warn({ accountId, provider, status: res.status, revoked }, "oauth token refresh failed");
    // "authentication failed" keys into isAuthError so the account flips to
    // auth_failed instead of retrying forever.
    throw new Error(
      revoked
        ? "authentication failed: access was revoked, reconnect the account"
        : `token refresh failed (${res.status})`,
    );
  }
  const tokens = (await res.json()) as TokenSet;
  const exp = Date.now() + (tokens.expires_in ?? 3600) * 1000;
  cache.set(accountId, { token: tokens.access_token, exp });
  return tokens.access_token;
}
