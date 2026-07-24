import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AccountInput,
  BillingState,
  EmailAccount,
  InboxPage,
  TestResult,
  ThreadDetail,
} from "./types.js";
import { api } from "./api.js";

export type ThreadOpName =
  | "archive"
  | "unarchive"
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "later"
  | "unlater";

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
}

export function useInbox(view: InboxView) {
  const { account = null, archived = false, starred = false, later = false } = view;
  return useInfiniteQuery({
    queryKey: ["inbox", account ?? "all", archived, starred, later],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      if (account) params.set("account", account);
      if (archived) params.set("archived", "1");
      if (starred) params.set("starred", "1");
      if (later) params.set("later", "1");
      return api<InboxPage>(`/api/inbox?${params.toString()}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: 15_000,
  });
}

export function useThread(threadId: string | null) {
  return useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => api<ThreadDetail>(`/api/threads/${threadId}`),
    enabled: Boolean(threadId),
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
                      archived: op === "archive" ? true : op === "unarchive" ? false : t.archived,
                      starred: op === "star" ? true : op === "unstar" ? false : t.starred,
                      read_later: op === "later" ? true : op === "unlater" ? false : t.read_later,
                    }
                  : t,
              )
              // Archive/unarchive removes the row from the current view.
              .filter((t) =>
                op === "archive" || op === "unarchive" ? t.id !== threadId : true,
              ),
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
      void qc.invalidateQueries({ queryKey: ["thread"] });
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
    onSettled: () => void qc.invalidateQueries({ queryKey: ["inbox"] }),
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

export function useReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, body_text }: { threadId: string; body_text: string }) =>
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
