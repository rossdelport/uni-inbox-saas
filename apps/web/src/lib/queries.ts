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
  ContactSuggestion,
  EmailAccount,
  InboxPage,
  Message,
  TestResult,
  ThreadDetail,
  ThreadSummary,
  SplitClass,
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

export function useContacts(query: string, accountId?: string | null) {
  const q = query.trim();
  return useQuery({
    queryKey: ["contacts", accountId ?? "all", q],
    queryFn: async () => {
      const params = new URLSearchParams({ q, limit: "8" });
      if (accountId) params.set("account", accountId);
      return api<{ contacts: ContactSuggestion[] }>(`/api/contacts?${params.toString()}`);
    },
    enabled: q.length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

/** Ask every selected mailbox syncer to run now. The icon animates while the
 * real request is pending; do not hold the interface for an artificial timer. */
export function useSyncAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountIds: string[]) => {
      await Promise.all(
        accountIds.map((id) => api(`/api/accounts/${id}/sync`, { method: "POST" })),
      );
      return accountIds.length;
    },
    onSuccess: () => {
      const refresh = () => {
        void qc.invalidateQueries({ queryKey: ["inbox"] });
        void qc.invalidateQueries({ queryKey: ["unread-counts"] });
        void qc.invalidateQueries({ queryKey: ["accounts"] });
      };
      refresh();
      // The endpoint wakes the background syncer rather than waiting for an
      // IMAP round trip. Follow up after it has had time to ingest new mail.
      setTimeout(refresh, 700);
      setTimeout(refresh, 2_000);
      setTimeout(refresh, 5_500);
    },
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
  /** Split chip on the plain Inbox: important | newsletter | other. */
  split?: string | null;
  /** Search across every mailbox at once (server-side; other filters ignored). */
  q?: string;
}

interface PendingReply {
  message: Message;
  state: "sending" | "sent";
}

const pendingReplyKey = (threadId: string) => ["pending-replies", threadId] as const;

// A mailbox move can overlap a Realtime event or polling refetch. Remember the
// destination the user chose so a stale response can never flash the row back
// into its old pile while the mutation is settling.
type PendingThreadLocation = "inbox" | "trash" | "gone";
const pendingThreadLocations = new Map<string, PendingThreadLocation>();

type InboxCache = { pages: InboxPage[] };

function matchesAccountView(key: readonly unknown[], accountId: string) {
  return key[1] === "all" || key[1] === accountId;
}

function isPlainInboxView(key: readonly unknown[], accountId: string) {
  return key[0] === "inbox"
    && matchesAccountView(key, accountId)
    && key[2] === false
    && key[3] === false
    && key[4] === false
    && key[5] === false
    && key[6] === false
    && key[7] === "all"
    && key[8] === "";
}

function isPlainDeletedView(key: readonly unknown[], accountId: string) {
  return key[0] === "inbox"
    && matchesAccountView(key, accountId)
    && key[2] === false
    && key[3] === false
    && key[4] === false
    && key[5] === true
    && key[6] === false
    && key[7] === "all"
    && key[8] === "";
}

function prependThread(data: InboxCache, thread: ThreadSummary): InboxCache {
  if (data.pages.some((page) => page.threads.some((item) => item.id === thread.id))) {
    return data;
  }
  return {
    ...data,
    pages: data.pages.map((page, index) => index === 0
      ? { ...page, threads: [thread, ...page.threads] }
      : page),
  };
}

const comparableBody = (body: string | null) =>
  (body ?? "").replace(/\r\n/g, "\n").trim();

/** Keep an optimistic reply in a fresh server response until the matching
 * outbound row exists. This protects the open thread from a stale read
 * during SMTP/IMAP reconciliation, just like the iOS client. */
function mergePendingReplies(detail: ThreadDetail, pending: PendingReply[]) {
  if (pending.length === 0) return { detail, matchedIds: [] as string[] };

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
      if (!candidate) continue;
      if (candidate.direction !== "outbound") continue;
      if (comparableBody(candidate.body_text) !== comparableBody(reply.message.body_text)) continue;
      if (candidate.from_address.toLowerCase() !== reply.message.from_address.toLowerCase()) continue;

      const delta = Math.abs(Date.parse(candidate.date) - sentAt);
      if (!Number.isFinite(delta) || delta > 10 * 60_000) continue;
      if (delta < closest) {
        closest = delta;
        matchIndex = index;
      }
    }

    if (matchIndex >= 0) {
      const matched = messages[matchIndex];
      if (!matched) continue;
      claimedServerIndexes.add(matchIndex);
      matchedIds.push(reply.message.id);
      messages[matchIndex] = {
        ...matched,
        // Keep the optimistic id for this render so the card can animate its
        // label instead of unmounting and letting the old message reopen.
        id: reply.message.id,
        client_delivery_state: "sent",
      };
    } else {
      unmatched.push(reply);
      messages.push({ ...reply.message, client_delivery_state: reply.state });
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
  const { account = null, archived = false, starred = false, later = false, deleted = false, sent = false, split = null, q = "" } = view;
  return useInfiniteQuery({
    queryKey: ["inbox", account ?? "all", archived, starred, later, deleted, sent, split ?? "all", q],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      if (q) params.set("q", q);
      if (deleted) params.set("deleted", "1");
      if (sent) params.set("sent", "1");
      if (account) params.set("account", account);
      if (archived) params.set("archived", "1");
      if (starred) params.set("starred", "1");
      if (later) params.set("later", "1");
      if (split) params.set("split", split);
      const page = await api<InboxPage>(`/api/inbox?${params.toString()}`);
      if (pendingThreadLocations.size === 0) return page;
      return {
        ...page,
        threads: page.threads.filter((thread) => {
          const pending = pendingThreadLocations.get(thread.id);
          if (!pending) return true;
          if (pending === "gone") return false;
          return deleted ? pending === "trash" : pending === "inbox";
        }),
      };
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
  /** Per-account per-split unread, summing to by_account. */
  by_account_split?: Record<string, Record<string, number>>;
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
  /** Scope to the split chip on screen, so "Read all" on Important cannot
   *  silently mark the newsletters read too. */
  split?: string | null;
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
    onMutate: async (scope) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["inbox"] }),
        qc.cancelQueries({ queryKey: ["unread-counts"] }),
      ]);
      const snapshots = qc.getQueriesData<{ pages: InboxPage[] }>({ queryKey: ["inbox"] });
      const countsBefore = qc.getQueryData<UnreadCounts>(["unread-counts"]);
      const wantedAccount = scope.account ?? "all";
      const wantedSplit = scope.split ?? "all";
      const affected = new Map<string, InboxPage["threads"][number]>();

      for (const [key, data] of snapshots) {
        if (!data || !Array.isArray(key)) continue;
        const exactView =
          key[0] === "inbox" &&
          key[1] === wantedAccount &&
          key[2] === Boolean(scope.archived) &&
          key[3] === Boolean(scope.starred) &&
          key[4] === Boolean(scope.later) &&
          key[5] === false &&
          key[6] === false &&
          key[7] === wantedSplit &&
          key[8] === "";
        if (!exactView) continue;
        qc.setQueryData(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            threads: page.threads.map((thread) => {
              if (!thread.unread) return thread;
              affected.set(thread.id, thread);
              return { ...thread, unread: false, counts_unread: false };
            }),
          })),
        });
      }

      const threadSnapshots = [...affected.keys()].map((id) => [
        id,
        qc.getQueryData<ThreadDetail>(["thread", id]),
      ] as const);
      for (const [id, detail] of threadSnapshots) {
        if (!detail) continue;
        qc.setQueryData<ThreadDetail>(["thread", id], {
          ...detail,
          thread: { ...detail.thread, unread: false, counts_unread: false },
        });
      }

      if (countsBefore) {
        const counted = [...affected.values()].filter((thread) => thread.counts_unread);
        const byAccount = { ...countsBefore.by_account };
        const byAccountSplit = countsBefore.by_account_split
          ? Object.fromEntries(
              Object.entries(countsBefore.by_account_split).map(([id, splits]) => [id, { ...splits }]),
            )
          : undefined;
        for (const thread of counted) {
          byAccount[thread.account_id] = Math.max(0, (byAccount[thread.account_id] ?? 0) - 1);
          const splits = byAccountSplit?.[thread.account_id];
          if (splits) splits[thread.split_class] = Math.max(0, (splits[thread.split_class] ?? 0) - 1);
        }
        qc.setQueryData<UnreadCounts>(["unread-counts"], {
          ...countsBefore,
          total: Math.max(0, countsBefore.total - counted.length),
          by_account: byAccount,
          by_account_split: byAccountSplit,
        });
      }
      return { snapshots, countsBefore, threadSnapshots };
    },
    onError: (_error, _scope, context) => {
      for (const [key, data] of context?.snapshots ?? []) qc.setQueryData(key, data);
      if (context?.countsBefore) qc.setQueryData(["unread-counts"], context.countsBefore);
      for (const [id, detail] of context?.threadSnapshots ?? []) {
        if (detail) qc.setQueryData(["thread", id], detail);
      }
    },
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
      if (op === "restore") pendingThreadLocations.set(threadId, "inbox");
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
        const keyParts = Array.isArray(key) ? key : [];
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
              // Unsnoozing also removes it from the Snoozed (later) view right
              // away; it will reappear in the Inbox after the server refresh.
              .filter((t) =>
                op === "archive" || op === "unarchive" || op === "restore"
                  ? t.id !== threadId
                  : op === "unlater" && Array.isArray(key) && key[0] === "inbox" && key[4] === true
                    ? t.id !== threadId
                    : true,
              ),
          })),
        });
        if (op === "restore" && before && isPlainInboxView(keyParts, before.account_id)) {
          qc.setQueryData<InboxCache>(key, (current) => current
            ? prependThread(current, before)
            : current);
        }
      }
      return { snapshots, countsBefore };
    },
    onError: (_err, vars, ctx) => {
      if (vars.op === "restore" && pendingThreadLocations.get(vars.threadId) === "inbox") {
        pendingThreadLocations.delete(vars.threadId);
      }
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
      // Put the badge back too, or a failed request leaves a number that is
      // quietly one lower than the truth until the next refetch.
      if (ctx?.countsBefore) qc.setQueryData(["unread-counts"], ctx.countsBefore);
    },
    onSettled: (_data, _error, variables) => {
      if (variables?.op === "restore" && pendingThreadLocations.get(variables.threadId) === "inbox") {
        pendingThreadLocations.delete(variables.threadId);
      }
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      // Opening a thread marks it read, and read/unread/archive all move the
      // badge. Without this the count is server-held and nothing tells it to
      // refetch, so it sat unchanged until the 60s poll: you clicked four
      // emails and the "4" stayed put.
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
      // Reading does not change the message body. Avoid fetching the open
      // thread again while an optimistic reply may be settling.
      if (variables?.op !== "read") {
        void qc.invalidateQueries({ queryKey: ["thread"] });
      }
    },
  });
}

/** Move one conversation into a split and optionally remember the choice for
 * the sender/domain that delivered it. */
export function useSplitThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      threadId,
      splitClass,
      remember = "thread",
    }: {
      threadId: string;
      splitClass: SplitClass;
      remember?: "thread" | "sender" | "domain";
    }) =>
      api<{ ok: boolean; split_class: SplitClass; split_reason: string; remember: string }>(
        `/api/inbox/threads/${threadId}/split`,
        {
          method: "POST",
          body: JSON.stringify({ split_class: splitClass, remember }),
        },
      ),
    onMutate: async ({ threadId, splitClass, remember }) => {
      await qc.cancelQueries({ queryKey: ["inbox"] });
      const snapshots = qc.getQueriesData<{ pages: InboxPage[] }>({ queryKey: ["inbox"] });
      const reason = remember === "thread"
        ? "You chose this category"
        : remember === "sender"
          ? "Your rule for this sender"
          : "Your rule for this domain";
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            threads: page.threads.map((thread) =>
              thread.id === threadId
                ? { ...thread, split_class: splitClass, split_reason: reason, split_manual: true }
                : thread,
            ),
          })),
        });
      }
      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_data, _error, variables) => {
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["thread", variables?.threadId] });
    },
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => api(`/api/inbox/threads/${threadId}`, { method: "DELETE" }),
    // Optimistic: move the row into any cached Deleted pile immediately.
    onMutate: async (threadId) => {
      pendingThreadLocations.set(threadId, "trash");
      await qc.cancelQueries({ queryKey: ["inbox"] });
      const snapshots = qc.getQueriesData<{ pages: InboxPage[] }>({ queryKey: ["inbox"] });
      const thread = snapshots
        .flatMap(([, data]) => data?.pages.flatMap((page) => page.threads) ?? [])
        .find((item) => item.id === threadId);
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const keyParts = Array.isArray(key) ? key : [];
        qc.setQueryData(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            threads: page.threads.filter((t) => t.id !== threadId),
          })),
        });
        if (thread && isPlainDeletedView(keyParts, thread.account_id)) {
          qc.setQueryData<InboxCache>(key, (current) => current
            ? prependThread(current, thread)
            : current);
        }
      }
      return { snapshots };
    },
    onError: (_err, threadId, ctx) => {
      if (pendingThreadLocations.get(threadId) === "trash") {
        pendingThreadLocations.delete(threadId);
      }
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_data, _error, threadId) => {
      if (pendingThreadLocations.get(threadId) === "trash") {
        pendingThreadLocations.delete(threadId);
      }
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      // Binning an unread conversation drops it out of the count too.
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
    },
  });
}

/** Permanently remove a conversation from its mail provider and local trash. */
export function usePermanentDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      api(`/api/inbox/threads/${threadId}/permanent`, { method: "DELETE" }),
    // The row disappears immediately after the user confirms. If the mail
    // server rejects the operation, restore the cached Deleted list so the
    // conversation remains recoverable.
    onMutate: async (threadId) => {
      pendingThreadLocations.set(threadId, "gone");
      await qc.cancelQueries({ queryKey: ["inbox"] });
      const snapshots = qc.getQueriesData<{ pages: InboxPage[] }>({ queryKey: ["inbox"] });
      for (const [key, data] of snapshots) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            threads: page.threads.filter((thread) => thread.id !== threadId),
          })),
        });
      }
      return { snapshots };
    },
    onError: (_error, threadId, context) => {
      if (pendingThreadLocations.get(threadId) === "gone") {
        pendingThreadLocations.delete(threadId);
      }
      for (const [key, data] of context?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: (_data, error, threadId) => {
      if (threadId && pendingThreadLocations.get(threadId) === "gone") {
        pendingThreadLocations.delete(threadId);
      }
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
      if (!error && threadId) void qc.removeQueries({ queryKey: ["thread", threadId] });
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
    mutationFn: ({ id, ...patch }: {
      id: string;
      label?: string;
      color?: string;
      password?: string;
      status?: "active" | "disabled";
      signature_html?: string | null;
      signature_text?: string | null;
    }) =>
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

export function useDetectSignature() {
  return useMutation({
    mutationFn: (accountId: string) =>
      api<{
        found: boolean;
        signature_html?: string;
        signature_text?: string;
        reason?: "no_sent" | "no_match";
        samples?: number;
      }>(`/api/accounts/${accountId}/signature/detect`, { method: "POST" }),
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
      send_at,
    }: {
      threadId: string;
      body_text: string;
      body_html?: string;
      attachments?: OutgoingAttachment[];
      cc?: string[];
      bcc?: string[];
      /** ISO instant for Send Later; omitted = send after the undo window. */
      send_at?: string;
    }) =>
      api<QueuedSend>(`/api/threads/${threadId}/reply`, {
        method: "POST",
        // One token per submission attempt: a retried or double-clicked send
        // resolves to the same outbox row server-side.
        body: JSON.stringify({ body_text, body_html, attachments, cc, bcc, send_at, client_token: crypto.randomUUID() }),
      }),
    onMutate: async ({ threadId, body_text, body_html, attachments, cc, send_at }) => {
      await qc.cancelQueries({ queryKey: ["thread", threadId] });
      const previous = qc.getQueryData<ThreadDetail>(["thread", threadId]);
      // Send Later creates an outbox row but not a message yet. Keep the
      // existing outbox-only UX for scheduled mail; immediate replies get
      // the optimistic thread treatment below.
      if (!previous || send_at) return { previous, optimisticId: null };

      const now = new Date().toISOString();
      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        thread_id: threadId,
        account_id: previous.thread.account_id,
        from_name: null,
        from_address: previous.thread.account_email,
        to_addresses: [],
        cc_addresses: cc ?? [],
        subject: previous.thread.subject,
        date: now,
        body_text,
        body_html: body_html ?? null,
        snippet: body_text.replace(/\s+/g, " ").trim().slice(0, 140),
        seen: true,
        direction: "outbound",
        // The server will add the real metadata during reconciliation. The
        // visible reply itself is complete immediately, including rich HTML.
        attachments: attachments?.map((attachment, index) => ({
          partId: `optimistic-${index + 1}`,
          filename: attachment.filename,
          contentType: attachment.content_type ?? "application/octet-stream",
          size: Math.floor((attachment.data_base64.length * 3) / 4),
        })) ?? [],
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

      // SMTP accepted an immediate send. Flip only the label; the reply card
      // and its key stay mounted so the text can roll into Sent in place.
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
      void qc.invalidateQueries({ queryKey: ["outbox"] });
      if (!optimisticId) return;

      // Reconcile in the background, but only while this exact optimistic
      // reply is still pending. useThread merges stale responses with it, so
      // the message cannot disappear during the handover.
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
    mutationFn: (input: { account_id: string; to: string[]; subject: string; body_text: string; body_html?: string; send_at?: string }) =>
      api<QueuedSend>("/api/messages/send", {
        method: "POST",
        body: JSON.stringify({ ...input, client_token: crypto.randomUUID() }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["outbox"] });
    },
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (tier: "monthly" | "yearly" | "lifetime") =>
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

/** Snooze a thread until an ISO instant. Local-only state; the thread leaves
 *  the Inbox immediately and returns at the wake time (or when new mail
 *  lands on it, whichever comes first). */
export function useSnooze() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, until }: { threadId: string; until: string }) =>
      api<{ ok: boolean; snooze_until: string }>(`/api/inbox/threads/${threadId}/snooze`, {
        method: "POST",
        body: JSON.stringify({ until }),
      }),
    onMutate: async ({ threadId, until }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["inbox"] }),
        qc.cancelQueries({ queryKey: ["thread", threadId] }),
        qc.cancelQueries({ queryKey: ["unread-counts"] }),
      ]);
      const snapshots = qc.getQueriesData<{ pages: InboxPage[] }>({ queryKey: ["inbox"] });
      const threadBefore = qc.getQueryData<ThreadDetail>(["thread", threadId]);
      const countsBefore = qc.getQueryData<UnreadCounts>(["unread-counts"]);
      const before = threadBefore?.thread ?? snapshots
        .flatMap(([, data]) => data?.pages.flatMap((page) => page.threads) ?? [])
        .find((thread) => thread.id === threadId);

      for (const [key, data] of snapshots) {
        if (!data) continue;
        const isSnoozedView = Array.isArray(key) && key[0] === "inbox" && key[4] === true;
        qc.setQueryData(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            threads: isSnoozedView
              ? page.threads.map((thread) => thread.id === threadId
                ? { ...thread, read_later: true, snooze_until: until, counts_unread: false }
                : thread)
              : page.threads.filter((thread) => thread.id !== threadId),
          })),
        });
      }

      if (threadBefore) {
        qc.setQueryData<ThreadDetail>(["thread", threadId], {
          ...threadBefore,
          thread: {
            ...threadBefore.thread,
            read_later: true,
            snooze_until: until,
            counts_unread: false,
          },
        });
      }
      if (before?.counts_unread && countsBefore) {
        const accountId = before.account_id;
        const splitCounts = countsBefore.by_account_split?.[accountId];
        qc.setQueryData<UnreadCounts>(["unread-counts"], {
          ...countsBefore,
          total: Math.max(0, countsBefore.total - 1),
          by_account: {
            ...countsBefore.by_account,
            [accountId]: Math.max(0, (countsBefore.by_account[accountId] ?? 0) - 1),
          },
          by_account_split: countsBefore.by_account_split
            ? {
                ...countsBefore.by_account_split,
                [accountId]: splitCounts
                  ? {
                      ...splitCounts,
                      [before.split_class]: Math.max(0, (splitCounts[before.split_class] ?? 0) - 1),
                    }
                  : {},
              }
            : undefined,
        });
      }
      return { snapshots, threadBefore, countsBefore };
    },
    onError: (_error, { threadId }, context) => {
      for (const [key, data] of context?.snapshots ?? []) qc.setQueryData(key, data);
      if (context?.threadBefore) qc.setQueryData(["thread", threadId], context.threadBefore);
      if (context?.countsBefore) qc.setQueryData(["unread-counts"], context.countsBefore);
    },
    onSettled: (_data, _error, { threadId }) => {
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["unread-counts"] });
      void qc.invalidateQueries({ queryKey: ["thread", threadId] });
    },
  });
}

// ── Outbox (undo send / send later) ─────────────────

export interface QueuedSend {
  ok: boolean;
  queued?: boolean;
  outbox_id?: string;
  status?: string;
  not_before?: string;
  undo_seconds?: number;
}

export interface OutboxItem {
  id: string;
  account_id: string;
  thread_id: string | null;
  kind: string;
  status: string;
  not_before: string;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  subject: string | null;
  to: string[];
}

/** Sends still in motion for one thread (queued/sending/failed/unknown).
 *  Polls fast while anything is pending: the undo countdown lives on this. */
export function useOutboxForThread(threadId: string | null) {
  return useQuery({
    queryKey: ["outbox", threadId],
    queryFn: () => api<{ items: OutboxItem[] }>(`/api/outbox?thread=${threadId}`),
    enabled: Boolean(threadId),
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some((i) => i.status === "queued" || i.status === "sending")
        ? 2_500
        : false,
  });
}

/** Everything scheduled for later (the Sent tab's top strip). */
export function useScheduledSends(enabled: boolean) {
  return useQuery({
    queryKey: ["outbox", "scheduled"],
    queryFn: () => api<{ items: OutboxItem[] }>(`/api/outbox?scheduled=1`),
    enabled,
    refetchInterval: 30_000,
  });
}

export function useCancelOutbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/outbox/${id}/cancel`, { method: "POST" }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["outbox"] }),
  });
}

// ── Snippets ─────────────────────

export interface Snippet {
  id: string;
  shortcut: string;
  name: string;
  body_text: string;
  body_html: string | null;
}

export function useSnippets() {
  return useQuery({
    queryKey: ["snippets"],
    queryFn: () => api<{ snippets: Snippet[] }>("/api/snippets"),
    staleTime: 60_000,
  });
}

export function useCreateSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { shortcut: string; name: string; body_text: string; body_html?: string }) =>
      api<Snippet>("/api/snippets", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["snippets"] }),
  });
}

export function useDeleteSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/snippets/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["snippets"] }),
  });
}

// ── AI summaries (paid add-on) ─────────────────────

export interface AiSummary {
  summary: string;
  cached: boolean;
  model: string;
  created_at: string;
}

/** Cached summary for a thread. Only asked for when the add-on is active, and
 *  serves purely from the server-side cache: it can never spend tokens. */
export function useAiSummary(threadId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["ai-summary", threadId],
    queryFn: () => api<{ summary: AiSummary | null }>(`/api/ai/summary/${threadId}`),
    enabled: enabled && Boolean(threadId),
    staleTime: 60_000,
  });
}

/** Generate (or refresh) the summary for a thread. The paid call. */
export function useSummarize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) =>
      api<{ summary: AiSummary }>(`/api/ai/summary/${threadId}`, { method: "POST" }),
    onSuccess: (r, threadId) => {
      qc.setQueryData(["ai-summary", threadId], { summary: r.summary });
    },
  });
}

/** Start the AI add-on checkout ($3/month). */
export function useAiCheckout() {
  return useMutation({
    mutationFn: () => api<{ url: string }>("/api/billing/ai-addon", { method: "POST" }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
}
