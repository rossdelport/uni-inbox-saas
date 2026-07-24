import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

// AES-256-GCM for mail credentials at rest. Blob format is versioned
// ("v1:<iv>:<tag>:<ciphertext>", all base64) so a future key rotation can
// re-encrypt in place without a schema change.
const KEY = Buffer.from(env.CREDENTIALS_KEY, "base64");

export interface MailCredentials {
  // Password accounts: the mailbox password (smtp_password falls back to it).
  imap_password?: string;
  smtp_password?: string;
  // OAuth accounts: the long-lived refresh token instead of any password.
  refresh_token?: string;
}

export function encryptCredentials(creds: MailCredentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(creds), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptCredentials(blob: string): MailCredentials {
  const [version, ivB64, tagB64, ctB64] = blob.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("unrecognized credential blob format");
  }
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as MailCredentials;
}
