import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AccountInput,
  BillingState,
  DiscoverResult,
  EmailAccount,
  InboxPage,
  Message,
  TestResult,
  ThreadDetail,
} from "./types";
import { api } from "./api";
import { realtimeHealthy } from "./realtime";

// Ported from apps/web/src/lib/queries.ts, minus the hooks that only make
// sense in a browser (OAuth redirects, Stripe checkout, account connect —
// all of that stays on the web). Query keys and optimistic-update behaviour
// are kept identical so the two clients stay easy to reason about together.

export type ThreadOpName =
  | "archive"
  | "unarchive"
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "later"
  | "unlater"
  | "restore";

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<EmailAccount[]>("/api/accounts"),
    refetchInterval: 30_000,
  });
}

/** Wake every active mailbox's background syncer. The endpoint returns as
 * soon as the nudge is accepted, so keep the pending state visible briefly
 * and refresh the inbox again while the new messages arrive. */
export function useSyncAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountIds: string[]) => {
      await Promise.all([
        Promise.all(
          accountIds.map((id) => api(`/api/accounts/${id}/sync`, { method: "POST" })),
        ),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
      return accountIds.length;
    },
    onSuccess: () => {
      const refresh = () => {
        void qc.invalidateQueries({ queryKey: ["inbox"] });
        void qc.invalidateQueries({ queryKey: ["unread-counts"] });
        void qc.invalidateQueries({ queryKey: ["accounts"] });
      };
      refresh();
      // The nudge wakes the worker rather than waiting for the IMAP round
      // trip, so follow up after it has had time to ingest new mail.
      setTimeout(refresh, 2_500);
      setTimeout(refresh, 6_000);
    },
  });
}

/** `enabled` exists because this one runs in the session-guarded layout,
 *  which mounts for a beat on cold start before the stored session has been
 *  read back. Firing then means an unauthenticated 401 that React Query
 *  caches as an error, leaving billing undefined after sign-in with nothing
 *  scheduled to retry it: the gate would quietly fail open. */
export function useBillingState(enabled = true) {
  return useQuery({
    queryKey: ["billing"],
    queryFn: () => api<BillingState>("/api/billing/state"),
    enabled,
    // This one gates the whole app, so it must not be able to get stuck. The
    // usual unstick is refetch-on-focus (wired to AppState in the root
    // layout); the interval is the belt to that pair of braces, for a user
    // sitting on the plan screen while a webhook lands.
    refetchInterval: 60_000,
  });
}

export interface InboxView {
  account?: string | null;
  archived?: boolean;
  starred?: boolean;
  later?: boolean;
  deleted?: boolean;
  /** Threads this user has replied to or started. */
  sent?: boolean;
  /** Search across every mailbox at once (server-side; other filters ignored). */
  q?: string;
}

interface PendingReply {
  message: Message;
  state: "sending" | "sent";
}

const pendingReplyKey = (threadId: string) => ["pending-replies", threadId] as const;

const comparableBody = (body: string | null) =>
  (body ?? "").replace(/\r\n/g, "\n").trim();

/** Merge locally sent replies into a fresh server thread without ever
 * allowing a briefly stale response to erase them. Once the matching server
 * row appears, it takes over atomically while keeping the optimistic id for
 * that render, so MessageCard remains mounted through Sending -> Sent. */
function mergePendingReplies(detail: ThreadDetail, pending: PendingReply[]) {
  if (pending.length === 0) {
    return { detail, matchedIds: [] as string[] };
  }

  const messages = detail.messages.map((message) => ({ ...message }));
  const claimedServerIndexes = new Set<number>();
  const matchedIds: string[] = [];
  const unmatched: PendingReply[] = [];

  for (const reply of pending) {
    const sentAt = Date.parse(reply.message.date);
    let matchIndex = -1;
    let closest = Number.POSITIVE_INFINITY;

    for (let index = 0; index < messages.length; index += 1) {
      if (claimedServerIndexes.has(index)) continue;
      const candidate = messages[index];
      if (candidate.direction !== "outbound") continue;
      if (comparableBody(candidate.body_text) !== comparableBody(reply.message.body_text)) continue;
      if (candidate.from_address.toLowerCase() !== reply.message.from_address.toLowerCase()) continue;

      const candidateAt = Date.parse(candidate.date);
      const delta = Math.abs(candidateAt - sentAt);
      // SMTP plus provider ingestion can take a while, but a same-body email
      // outside this window is an older reply and must not consume this one.
      if (!Number.isFinite(delta) || delta > 10 * 60_000) continue;
      if (delta < closest) {
        closest = delta;
        matchIndex = index;
      }
    }

    if (matchIndex >= 0) {
      claimedServerIndexes.add(matchIndex);
      matchedIds.push(reply.message.id);
      messages[matchIndex] = {
        ...messages[matchIndex],
        // Preserve the React key for this handover. There is never a render
        // in which the outgoing card is absent or the prior email reopens.
        id: reply.message.id,
        client_delivery_state: "sent",
      };
    } else {
      unmatched.push(reply);
      messages.push({
        ...reply.message,
        client_delivery_state: reply.state,
      });
    }
  }

  messages.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const newest = messages[messages.length - 1];
  return {
    matchedIds,
    detail: {
      ...detail,
      thread: {
        ...detail.thread,
        message_count: detail.thread.message_count + unmatched.length,
        last_message_at: newest?.date ?? detail.thread.last_message_at,
        snippet: newest?.snippet ?? detail.thread.snippet,
      },
      messages,
    },
  };
}

export function useInbox(view: InboxView) {
  const { account = null, archived = false, starred = false, later = false, deleted = false, sent = false, q = "" } = view;
  return useInfiniteQuery({
    queryKey: ["inbox", account ?? "all", archived, starred, later, deleted, sent, q],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      if (q) params.set("q", q);
      if (deleted) params.set("deleted", "1");
      if (sent) params.set("sent", "1");
      if (account) params.set("account", account);
      if (archived) params.set("archived", "1");
      if (starred) params.set("starred", "1");
      if (later) params.set("later", "1");
      return api<InboxPage>(`/api/inbox?${params.toString()}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // Realtime is the fast path; this is the safety net, so its pace depends
    // on whether realtime is actually delivering: 60s while it is, 15s the
    // moment it is not.
    refetchInterval: () => (realtimeHealthy() ? 60_000 : 15_000),
  });
}

export function useThread(threadId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["thread", threadId],
    queryFn: async () => {
      if (!threadId) throw new Error("thread id is required");
      const remote = await api<ThreadDetail>(`/api/threads/${threadId}`);
      const key = pendingReplyKey(threadId);
      const pending = qc.getQueryData<PendingReply[]>(key) ?? [];
      const merged = mergePendingReplies(remote, pending);
      if (merged.matchedIds.length > 0) {
        const matched = new Set(merged.matchedIds);
        qc.setQueryData<PendingReply[]>(key, (current = []) =>
          current.filter((reply) => !matched.has(reply.message.id)),
        );
      }
      return merged.detail;
    },
    enabled: Boolean(threadId),
  });
}

export interface UnreadCounts {
  total: number;
  by_account: Record<string, number>;
}

/** Badge numbers. Server-counted, and only mail that landed after each
 *  account was connected: an imported backlog is not news. */
export function useUnreadCounts() {
  return useQuery({
    queryKey: ["unread-counts"],
    queryFn: () => api<UnreadCounts>("/api/inbox/counts"),
    refetchInterval: () => (realtimeHealthy() ? 60_000 : 15_000),
  });
}

export interface ReadAllScope {
  account?: string | null;
  archived?: boolean;
  starred?: boolean;
  later?: boolean;
}

/** Clear unread across the current view. Scoped server-side by the same
 *  filters the list uses, so it only touches what is actually on screen. */
export function useReadAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scope: ReadAllScope) =>
      api<{ marked: number; remaining: boolean }>("/api/inbox/read-all", {
        method: "POST",
        body: JSON.stringify(scope),
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
    },
  });
}

export function useThreadOp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, op }: { threadId: string; op: ThreadOpName }) =>
      api(`/api/inbox/threads/${threadId}/${op}`, { method: "POST" }),
    // Optimistic: flip the row in every cached inbox page immediately.
    onMutate: async ({ threadId, op }) => {
      await qc.cancelQueries({ queryKey: ["inbox"] });
      const snapshots = qc.getQueriesData<{ pages: InboxPage[] }>({ queryKey: ["inbox"] });

      // Move the badge on the tap, not two round trips later. Only threads
      // the server says are counted can move it: opening one of the
      // pre-connection backlog must leave it alone, since it was never in
      // the number to begin with.
      const before = snapshots
        .flatMap(([, d]) => d?.pages.flatMap((p) => p.threads) ?? [])
        .find((t) => t.id === threadId);
      const delta =
        op === "read" && before?.counts_unread
          ? -1
          : op === "unread" && before && !before.unread
            ? 1
            : 0;
      const countsKey = ["unread-counts"] as const;
      const countsBefore = qc.getQueryData<UnreadCounts>(countsKey);
      if (delta !== 0 && countsBefore && before) {
        const acct = before.account_id;
        qc.setQueryData<UnreadCounts>(countsKey, {
          total: Math.max(0, countsBefore.total + delta),
          by_account: {
            ...countsBefore.by_account,
            [acct]: Math.max(0, (countsBefore.by_account[acct] ?? 0) + delta),
          },
        });
      }
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            threads: page.threads
              .map((t) =>
                t.id === threadId
                  ? {
                      ...t,
                      unread: op === "unread" ? true : op === "read" ? false : t.unread,
                      // Cleared with unread so a second tap cannot decrement
                      // the badge twice off one conversation.
                      counts_unread: op === "read" ? false : t.counts_unread,
                      archived: op === "archive" ? true : op === "unarchive" ? false : t.archived,
                      starred: op === "star" ? true : op === "unstar" ? false : t.starred,
                      read_later: op === "later" ? true : op === "unlater" ? false : t.read_later,
                    }
                  : t,
              )
              // Archive/unarchive/restore removes the row from the current view.
              .filter((t) =>
                op === "archive" || op === "unarchive" || op === "restore" ? t.id !== threadId : true,
              ),
          })),
        });
      }
      return { snapshots, countsBefore };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
      // Put the badge back too, or a failed request leaves a number that is
      // quietly one lower than the truth until the next refetch.
      if (ctx?.countsBefore) qc.setQueryData(["unread-counts"], ctx.countsBefore);
    },
    onSettled: (_data, _error, variables) => {
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
      // Marking a message read does not change its contents. Avoid a second
      // thread fetch here so it cannot race an optimistic reply and briefly
      // remove the new outgoing bubble while the send is settling.
      if (variables?.op !== "read") {
        void qc.invalidateQueries({ queryKey: ["thread"] });
      }
    },
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => api(`/api/inbox/threads/${threadId}`, { method: "DELETE" }),
    // Optimistic: drop the row from every cached inbox page immediately.
    onMutate: async (threadId) => {
      await qc.cancelQueries({ queryKey: ["inbox"] });
      const snapshots = qc.getQueriesData<{ pages: InboxPage[] }>({ queryKey: ["inbox"] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            threads: page.threads.filter((t) => t.id !== threadId),
          })),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
    },
  });
}

// Account management. Deliberately no useCheckout / useAddSeat here: those
// start a purchase, and the iOS app is a read/write companion to an existing
// OneInbox account rather than a purchase surface.

export function useOauthProviders() {
  return useQuery({
    queryKey: ["oauth-providers"],
    queryFn: () => api<{ google: boolean; microsoft: boolean }>("/api/oauth/providers"),
    // Deploy-time server config, so it cannot change under a running app.
    staleTime: Infinity,
  });
}

export function useDeleteOwnAccount() {
  return useMutation({
    mutationFn: () =>
      api<{ ok: true }>("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ confirm: "DELETE" }),
      }),
  });
}

export function useOauthStartUrl() {
  return useMutation({
    mutationFn: (provider: "google" | "microsoft") =>
      api<{ url: string }>(`/api/oauth/${provider}/start`, {
        method: "POST",
        body: JSON.stringify({ client: "mobile" }),
      }),
  });
}

export function useDiscover() {
  return useMutation({
    mutationFn: (email: string) =>
      api<DiscoverResult>("/api/accounts/discover", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (input: AccountInput) =>
      api<TestResult>("/api/accounts/test", { method: "POST", body: JSON.stringify(input) }),
  });
}

export function useConnectAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountInput) =>
      api<EmailAccount>("/api/accounts", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      label?: string;
      color?: string;
      password?: string;
      status?: "active" | "disabled";
    }) => api<EmailAccount>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
      // Rows and open threads carry the account colour and label with them.
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["thread"] });
    },
  });
}

export function useRemoveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/accounts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
    },
  });
}

export function useCompose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { account_id: string; to: string[]; subject: string; body_text: string }) =>
      api<{ thread_id?: string; queued?: boolean; outbox_id?: string }>("/api/messages/send", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      threadId,
      body_text,
    }: {
      threadId: string;
      body_text: string;
    }) =>
      api<{ queued?: boolean; message_id?: string }>(`/api/threads/${threadId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body_text }),
      }),
    onMutate: async ({ threadId, body_text }) => {
      await qc.cancelQueries({ queryKey: ["thread", threadId] });
      const previous = qc.getQueryData<ThreadDetail>(["thread", threadId]);
      if (!previous) return { previous, optimisticId: null };

      const now = new Date().toISOString();
      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        thread_id: threadId,
        account_id: previous.thread.account_id,
        from_name: null,
        from_address: previous.thread.account_email,
        to_addresses: [],
        cc_addresses: [],
        subject: previous.thread.subject,
        date: now,
        body_text,
        body_html: null,
        snippet: body_text.replace(/\s+/g, " ").trim().slice(0, 140),
        seen: true,
        direction: "outbound",
        attachments: [],
        client_delivery_state: "sending",
      };
      qc.setQueryData<PendingReply[]>(pendingReplyKey(threadId), (current = []) => [
        ...current,
        { message: optimistic, state: "sending" },
      ]);
      qc.setQueryData<ThreadDetail>(["thread", threadId], {
        ...previous,
        thread: {
          ...previous.thread,
          last_message_at: now,
          message_count: previous.thread.message_count + 1,
          snippet: optimistic.snippet,
        },
        messages: [...previous.messages, optimistic],
      });
      return { previous, optimisticId: optimistic.id };
    },
    onError: (_error, { threadId }, context) => {
      if (context?.optimisticId) {
        qc.setQueryData<PendingReply[]>(pendingReplyKey(threadId), (current = []) =>
          current.filter((reply) => reply.message.id !== context.optimisticId),
        );
      }
      if (context?.previous) qc.setQueryData(["thread", threadId], context.previous);
    },
    onSuccess: (data, { threadId }, context) => {
      const optimisticId = context?.optimisticId;

      // A non-queued response means SMTP accepted the message. Change only
      // the delivery label here; keep the same card and React key in place.
      if (optimisticId && !data.queued) {
        qc.setQueryData<PendingReply[]>(pendingReplyKey(threadId), (current = []) =>
          current.map((reply) =>
            reply.message.id === optimisticId ? { ...reply, state: "sent" } : reply,
          ),
        );
        qc.setQueryData<ThreadDetail>(["thread", threadId], (current) =>
          current
            ? {
                ...current,
                messages: current.messages.map((message) =>
                  message.id === optimisticId
                    ? { ...message, client_delivery_state: "sent" }
                    : message,
                ),
              }
            : current,
        );
      }

      void qc.invalidateQueries({ queryKey: ["inbox"] });
      if (!optimisticId) return;

      // Poll only while this exact optimistic reply still needs its server
      // row. useThread merges each response with pendingReplies first, so a
      // stale response can never make the card disappear. The faster cadence
      // is for immediate sends; queued responses allow the worker more time.
      const delays = data.queued
        ? [800, 1_500, 3_000, 6_000, 10_000, 15_000, 30_000]
        : [200, 600, 1_200, 2_500, 5_000, 10_000];

      const reconcile = (attempt: number) => {
        if (attempt >= delays.length) return;
        const stillPending = () =>
          (qc.getQueryData<PendingReply[]>(pendingReplyKey(threadId)) ?? []).some(
            (reply) => reply.message.id === optimisticId,
          );
        if (!stillPending()) return;

        setTimeout(() => {
          if (!stillPending()) return;
          void qc
            .refetchQueries({ queryKey: ["thread", threadId], exact: true, type: "active" })
            .then(
              () => reconcile(attempt + 1),
              () => reconcile(attempt + 1),
            );
        }, delays[attempt]);
      };
      reconcile(0);
    },
  });
}
