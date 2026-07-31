import { createHash, randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import type { OutboundAttachment, OutboundInput, SendAccount } from "./smtpSend.js";

// The outbox enqueue side. A send becomes a row; the worker's drain delivers
// it after not_before. Undo Send is the gap between enqueue and drain, and
// Send Later is the same gap with a longer not_before. See 0023 for the
// status machine.

export interface QueuedSend {
  outbox_id: string;
  status: string;
  not_before: string;
  undo_seconds: number;
}

export interface EnqueueArgs {
  uid: string;
  account: SendAccount;
  threadId: string | null;
  kind: "reply" | "new" | "forward";
  input: OutboundInput;
  clientToken?: string | null;
  /** ISO instant for Send Later; omitted = now + the undo window. */
  sendAt?: string | null;
}

/** Serializable payload (attachments split out so success can null them). */
function payloadOf(input: OutboundInput): Record<string, unknown> {
  return {
    to: input.to,
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    subject: input.subject,
    body_text: input.bodyText,
    body_html: input.bodyHtml ?? null,
    in_reply_to: input.inReplyTo ?? null,
    references: input.references ?? [],
    from_name: input.fromName ?? null,
  };
}

export function inputOf(
  payload: Record<string, unknown>,
  attachments: unknown,
): OutboundInput {
  const atts = Array.isArray(attachments)
    ? (attachments as Array<{ filename: string; content_type?: string; data_base64: string }>).map(
        (a): OutboundAttachment => ({
          filename: a.filename,
          contentType: a.content_type,
          content: Buffer.from(a.data_base64, "base64"),
        }),
      )
    : undefined;
  return {
    to: (payload.to as string[]) ?? [],
    cc: (payload.cc as string[]) ?? [],
    bcc: (payload.bcc as string[]) ?? [],
    subject: (payload.subject as string) ?? "",
    bodyText: (payload.body_text as string) ?? "",
    bodyHtml: (payload.body_html as string | null) ?? undefined,
    attachments: atts,
    inReplyTo: (payload.in_reply_to as string | null) ?? null,
    references: (payload.references as string[]) ?? [],
    fromName: (payload.from_name as string | null) ?? null,
  };
}

/** Fallback idempotency token for clients that send none (the installed iOS
 *  build). Deterministic over the send's content in a 30s bucket: a double
 *  tap dedupes, an intentional identical resend a minute later does not. */
function fallbackToken(uid: string, args: EnqueueArgs): string {
  const bucket = Math.floor(Date.now() / 30_000);
  return createHash("sha256")
    .update(
      [
        uid,
        args.threadId ?? args.input.to.join(","),
        args.input.subject,
        args.input.bodyText,
        String(bucket),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 48);
}

export async function enqueueSend(args: EnqueueArgs): Promise<QueuedSend> {
  const domain = args.account.email_address.split("@")[1] ?? "oneinbox.local";
  const messageRfcId = `<${randomUUID()}@${domain}>`;
  const clientToken = args.clientToken?.trim() || fallbackToken(args.uid, args);
  const undoSeconds = env.OUTBOX_UNDO_SECONDS;
  const notBefore = args.sendAt ?? new Date(Date.now() + undoSeconds * 1000).toISOString();

  const atts = (args.input.attachments ?? []).map((a) => ({
    filename: a.filename,
    content_type: a.contentType,
    data_base64: a.content.toString("base64"),
  }));

  const { data, error } = await supabase
    .from("outbox")
    .insert({
      owner_id: args.uid,
      account_id: args.account.id,
      thread_id: args.threadId,
      kind: args.kind,
      status: "queued",
      not_before: notBefore,
      client_token: clientToken,
      message_rfc_id: messageRfcId,
      payload: payloadOf(args.input),
      attachments: atts.length > 0 ? atts : null,
    })
    .select("id, status, not_before")
    .maybeSingle();

  if (error) {
    // 23505 on (owner_id, client_token): the same submission already queued.
    // Return the existing row so a double-click resolves to ONE send.
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("outbox")
        .select("id, status, not_before")
        .eq("owner_id", args.uid)
        .eq("client_token", clientToken)
        .maybeSingle();
      if (existing) {
        return {
          outbox_id: existing.id as string,
          status: existing.status as string,
          not_before: existing.not_before as string,
          undo_seconds: undoSeconds,
        };
      }
    }
    logger.error({ err: error, uid: args.uid }, "outbox enqueue failed");
    throw new Error("Could not queue the send. Try again.");
  }

  return {
    outbox_id: data!.id as string,
    status: data!.status as string,
    not_before: data!.not_before as string,
    undo_seconds: undoSeconds,
  };
}
