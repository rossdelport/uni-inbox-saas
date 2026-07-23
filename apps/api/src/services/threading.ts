import { supabase } from "../lib/supabase.js";

// Conversation threading. RFC headers first (References / In-Reply-To against
// message ids we already hold for the account), then a fallback for clients
// that strip them: same account + normalized subject + a shared participant
// within 30 days. Otherwise a new thread.

/** "Re: Re: Fwd: Hello" -> "hello" */
export function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "")
    .replace(/^(\s*(re|fwd?|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

export interface IncomingMeta {
  ownerId: string;
  accountId: string;
  messageId: string | null;
  inReplyTo: string | null;
  referencesIds: string[];
  subject: string | null;
  fromAddress: string;
  toAddresses: string[];
  date: Date;
  snippet: string | null;
  seen: boolean;
}

/** Find the thread this message belongs to, or create one. Returns thread id. */
export async function resolveThread(meta: IncomingMeta): Promise<string> {
  const refCandidates = [...meta.referencesIds, meta.inReplyTo].filter(
    (r): r is string => Boolean(r),
  );

  if (refCandidates.length > 0) {
    const { data } = await supabase
      .from("messages")
      .select("thread_id")
      .eq("account_id", meta.accountId)
      .in("message_id", refCandidates)
      .limit(1);
    const hit = data?.[0]?.thread_id as string | undefined;
    if (hit) return hit;
  }

  const subjectNorm = normalizeSubject(meta.subject);
  if (subjectNorm) {
    const since = new Date(meta.date.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: candidates } = await supabase
      .from("threads")
      .select("id")
      .eq("account_id", meta.accountId)
      .eq("subject_norm", subjectNorm)
      .gte("last_message_at", since)
      .limit(5);
    for (const cand of candidates ?? []) {
      // Participant overlap check: someone in this message already appears in
      // the candidate thread (any direction).
      const participants = [meta.fromAddress, ...meta.toAddresses].map((a) => a.toLowerCase());
      const { data: overlap } = await supabase
        .from("messages")
        .select("id")
        .eq("thread_id", cand.id)
        .or(
          `from_address.in.(${participants.map((p) => `"${p}"`).join(",")}),` +
            `to_addresses.ov.{${participants.join(",")}}`,
        )
        .limit(1);
      if (overlap && overlap.length > 0) return cand.id as string;
    }
  }

  const { data: created, error } = await supabase
    .from("threads")
    .insert({
      owner_id: meta.ownerId,
      account_id: meta.accountId,
      subject_norm: subjectNorm || "(no subject)",
      last_message_at: meta.date.toISOString(),
      message_count: 0, // bumped by touchThread below
      unread: !meta.seen,
      snippet: meta.snippet,
    })
    .select("id")
    .single();
  if (error) throw new Error(`thread insert failed: ${error.message}`);
  return created.id as string;
}

/** Refresh a thread's rollup fields after inserting a message into it. */
export async function touchThread(threadId: string): Promise<void> {
  const { data: msgs } = await supabase
    .from("messages")
    .select("date, snippet, seen, direction")
    .eq("thread_id", threadId)
    .order("date", { ascending: false });
  if (!msgs || msgs.length === 0) return;
  const newest = msgs[0]!;
  const unread = msgs.some((m) => !m.seen && m.direction === "inbound");
  await supabase
    .from("threads")
    .update({
      last_message_at: newest.date,
      message_count: msgs.length,
      snippet: newest.snippet,
      unread,
      // New mail into an archived thread pulls it back to the inbox.
      ...(unread ? { archived: false } : {}),
    })
    .eq("id", threadId);
}
