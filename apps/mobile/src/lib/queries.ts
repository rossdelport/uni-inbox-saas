import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BillingState, EmailAccount, InboxPage, ThreadDetail } from "./types";
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
  return useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => api<ThreadDetail>(`/api/threads/${threadId}`),
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
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["thread"] });
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
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
      api(`/api/threads/${threadId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body_text }),
      }),
    onSuccess: (_data, { threadId }) => {
      void qc.invalidateQueries({ queryKey: ["thread", threadId] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}
