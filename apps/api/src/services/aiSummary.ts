import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

// AI thread summaries, the paid add-on. The contract with the marketing copy:
// no model ever sees a user's mail unless THEY switched summaries on, and
// Anthropic's API does not train on request content. Only the add-on route
// calls into this file, and the route gates on the add-on subscription before
// any code here runs.

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new Error("AI summaries aren't configured.");
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export function aiConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export class AiCapError extends Error {
  constructor() {
    super("Daily summary limit reached. It resets at midnight UTC.");
  }
}

export interface SummaryResult {
  summary: string;
  cached: boolean;
  model: string;
  created_at: string;
}

// Context bounds. A thread summary needs the shape of the conversation, not
// every byte of it: the last messages, truncated per message. ~1.5k tokens in
// on a typical thread, a couple of hundred out.
const MAX_MESSAGES = 12;
const MAX_CHARS_PER_MESSAGE = 4_000;
const MAX_OUTPUT_TOKENS = 300;

const SYSTEM_PROMPT =
  "You summarize one email conversation for the mailbox owner, addressed as \"you\". " +
  "Reply with 2 or 3 short plain-text sentences: what the conversation is about, the " +
  "latest development, and anything awaiting the owner's action (a question to answer, " +
  "a deadline, a payment). If nothing needs their action, do not invent one. No " +
  "preamble, no markdown, no bullet points. Use only facts present in the messages.";

interface ThreadRow {
  id: string;
  last_message_at: string;
  message_count: number;
}

/** Cached summary if it is still fresh for the thread's current state. */
export async function getCachedSummary(
  uid: string,
  threadId: string,
): Promise<SummaryResult | null> {
  const { data: thread } = await supabase
    .from("threads")
    .select("id, last_message_at, message_count")
    .eq("id", threadId)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) return null;
  return readCache(uid, thread as ThreadRow);
}

async function readCache(uid: string, thread: ThreadRow): Promise<SummaryResult | null> {
  const { data: hit } = await supabase
    .from("ai_summaries")
    .select("summary, model, thread_last_message_at, message_count, created_at")
    .eq("thread_id", thread.id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!hit) return null;
  const fresh =
    String(hit.thread_last_message_at) === String(thread.last_message_at) &&
    Number(hit.message_count) === Number(thread.message_count);
  if (!fresh) return null;
  return {
    summary: hit.summary as string,
    cached: true,
    model: hit.model as string,
    created_at: hit.created_at as string,
  };
}

/** Summarize a thread, serving the cache when fresh. Throws AiCapError at the
 *  daily cap. The reserve-then-call-then-refund ordering means an API failure
 *  never burns a slot, and a cap check happens before any tokens are spent. */
export async function summarizeThread(uid: string, threadId: string): Promise<SummaryResult> {
  const { data: thread } = await supabase
    .from("threads")
    .select("id, last_message_at, message_count")
    .eq("id", threadId)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!thread) throw new Error("thread not found");

  const cached = await readCache(uid, thread as ThreadRow);
  if (cached) return cached;

  // Reserve BEFORE the paid call, atomically. false (or a null from PostgREST)
  // means the cap is hit.
  const { data: reserved, error: bumpErr } = await supabase.rpc("bump_ai_counter", {
    p_owner: uid,
    p_cap: env.AI_DAILY_CAP,
  });
  if (bumpErr) {
    logger.error({ err: bumpErr, uid }, "ai counter reserve failed");
    throw new Error("Could not start the summary. Try again.");
  }
  if (reserved !== true) throw new AiCapError();

  try {
    const { data: msgs } = await supabase
      .from("messages")
      .select("from_name, from_address, date, direction, body_text, snippet, subject")
      .eq("thread_id", threadId)
      .eq("owner_id", uid)
      .order("date", { ascending: false })
      .limit(MAX_MESSAGES);

    const ordered = (msgs ?? []).reverse();
    if (ordered.length === 0) throw new Error("thread has no messages");

    const subject = (ordered[ordered.length - 1]?.subject as string | null) ?? "(no subject)";
    const transcript = ordered
      .map((m) => {
        const who =
          m.direction === "outbound"
            ? "You"
            : ((m.from_name as string | null) || (m.from_address as string));
        const body =
          ((m.body_text as string | null) ?? (m.snippet as string | null) ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, MAX_CHARS_PER_MESSAGE);
        return `${who} (${new Date(m.date as string).toUTCString()}):\n${body}`;
      })
      .join("\n\n---\n\n");

    const response = await anthropic().messages.create({
      model: env.AI_SUMMARY_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Subject: ${subject}\n\n${transcript}`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new Error("empty summary");

    const row = {
      thread_id: threadId,
      owner_id: uid,
      summary: text,
      model: env.AI_SUMMARY_MODEL,
      thread_last_message_at: thread.last_message_at as string,
      message_count: thread.message_count as number,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      created_at: new Date().toISOString(),
    };
    const { error: cacheErr } = await supabase
      .from("ai_summaries")
      .upsert(row, { onConflict: "thread_id" });
    if (cacheErr) logger.warn({ err: cacheErr, threadId }, "summary cache write failed");

    return { summary: text, cached: false, model: env.AI_SUMMARY_MODEL, created_at: row.created_at };
  } catch (err) {
    // The slot was reserved but nothing was delivered; give it back.
    await supabase.rpc("refund_ai_counter", { p_owner: uid }).then(({ error }) => {
      if (error) logger.warn({ err: error, uid }, "ai counter refund failed");
    });
    throw err;
  }
}
