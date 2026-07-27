import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AccountInput,
  DiscoverResult,
  BillingState,
  EmailAccount,
  InboxPage,
  TestResult,
  ThreadDetail,
} from "./types.js";
import { api } from "./api.js";
import { realtimeHealthy } from "./realtime.js";

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

// All server state flows through here. 15s refetch on the inbox keeps the
// list fresh between IDLE pushes without hammering the API.

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<EmailAccount[]>("/api/accounts"),
    refetchInterval: 30_000,
  });
}

export function useBillingState() {
  return useQuery({
    queryKey: ["billing"],
    queryFn: () =>
      api<BillingState & { plans: { id: string; label: string; max_inboxes: number; price_usd: number }[] }>(
        "/api/billing/state",
      ),
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
    // moment it is not. refetchIntervalInBackground because the default skips
    // ticks on an unfocused tab, which froze the "(3) OneInbox" badge exactly
    // when it was the only thing the user could see.
    refetchInterval: () => (realtimeHealthy() ? 60_000 : 15_000),
    refetchIntervalInBackground: true,
  });
}

export function useThread(threadId: string | null) {
  return useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => api<ThreadDetail>(`/api/threads/${threadId}`),
    enabled: Boolean(threadId),
  });
}

export interface BackfillResult {
  added: number;
  exhausted: boolean;
}

/** Pull the next block of older mail from the mail server, once the user has
 *  scrolled past everything already stored locally. */
export function useBackfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (account: string | null) =>
      api<BackfillResult>(`/api/inbox/backfill${account ? `?account=${account}` : ""}`, {
        method: "POST",
      }),
    onSuccess: (r) => {
      // Only refetch when something actually landed, so an empty result does
      // not churn the list the user is reading.
      if (r.added > 0) void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

export interface UnreadCounts {
  total: number;
  by_account: Record<string, number>;
}

/** Sidebar and tab-title numbers. Server-counted, and only mail that landed
 *  after each account was connected: an imported backlog is not news. */
export function useUnreadCounts() {
  return useQuery({
    queryKey: ["unread-counts"],
    queryFn: () => api<UnreadCounts>("/api/inbox/counts"),
    // Realtime invalidates this the moment mail lands; the interval is the
    // fallback, in the background so the tab badge keeps moving while the
    // user is on another tab, which is the whole point of a badge. Fast
    // fallback whenever the realtime channel is not actually delivering.
    refetchInterval: () => (realtimeHealthy() ? 60_000 : 15_000),
    refetchIntervalInBackground: true,
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

      // Move the badge on the click, not two round trips later (the op, then
      // a refetch of the count). Only threads the server says are counted can
      // move it: opening one of the pre-connection backlog must leave it
      // alone, since it was never in the number to begin with.
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
                      // Cleared with unread so a second click cannot decrement
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
      // Opening a thread marks it read, and read/unread/archive all move the
      // badge. Without this the count is server-held and nothing tells it to
      // refetch, so it sat unchanged until the 60s poll: you clicked four
      // emails and the "4" stayed put.
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
      // Binning an unread conversation drops it out of the count too.
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
    },
  });
}

export function useOauthProviders() {
  return useQuery({
    queryKey: ["oauth-providers"],
    queryFn: () => api<{ google: boolean; microsoft: boolean }>("/api/oauth/providers"),
    // Which OAuth providers are configured is deploy-time server config, so it
    // cannot change under a running tab. Caching it for the session keeps the
    // connect modal instant on every open, not just within a 5 minute window.
    staleTime: Infinity,
  });
}

export function useOauthStart() {
  return useMutation({
    mutationFn: (provider: "google" | "microsoft") =>
      api<{ url: string }>(`/api/oauth/${provider}/start`, { method: "POST" }),
    onSuccess: ({ url }) => window.location.assign(url),
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
    },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; label?: string; color?: string; password?: string; status?: "active" | "disabled" }) =>
      api<EmailAccount>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["billing"] });
      // Rows and open threads carry the account colour/label with them.
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
    },
  });
}

export interface OutgoingAttachment {
  filename: string;
  content_type?: string;
  data_base64: string;
}

export function useReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      threadId,
      body_text,
      body_html,
      attachments,
      cc,
      bcc,
    }: {
      threadId: string;
      body_text: string;
      body_html?: string;
      attachments?: OutgoingAttachment[];
      cc?: string[];
      bcc?: string[];
    }) =>
      api(`/api/threads/${threadId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body_text, body_html, attachments, cc, bcc }),
      }),
    onSuccess: (_data, { threadId }) => {
      void qc.invalidateQueries({ queryKey: ["thread", threadId] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

export function useForward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, to, note }: { threadId: string; to: string[]; note?: string }) =>
      api(`/api/threads/${threadId}/forward`, {
        method: "POST",
        body: JSON.stringify({ to, note }),
      }),
    onSuccess: (_data, { threadId }) => {
      void qc.invalidateQueries({ queryKey: ["thread", threadId] });
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

export function useCompose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { account_id: string; to: string[]; subject: string; body_text: string }) =>
      api<{ thread_id: string }>("/api/messages/send", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inbox"] }),
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (tier: "monthly" | "lifetime") =>
      api<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ tier }),
      }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

export function useAddSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ quantity: number }>("/api/billing/add-seat", { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["billing"] }),
  });
}

export function usePortal() {
  return useMutation({
    mutationFn: () => api<{ url: string }>("/api/billing/portal", { method: "POST" }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}
