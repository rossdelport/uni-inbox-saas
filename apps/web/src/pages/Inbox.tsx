import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useAccounts, useInbox, useThreadOp } from "../lib/queries.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { ConnectAccountModal } from "../components/ConnectAccountModal.js";
import { ReadingPane } from "./ThreadView.js";
import type { AppOutletContext } from "../components/Layout.js";
import type { ThreadSummary } from "../lib/types.js";

// Mail surface: message list pane + reading pane side by side. Routes "/",
// "/archived" and "/t/:threadId" all land here; the param opens a thread.
export function Inbox({ archived = false }: { archived?: boolean }) {
  const [params] = useSearchParams();
  const { threadId } = useParams();
  const account = params.get("account");
  const { search } = useOutletContext<AppOutletContext>();
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const inbox = useInbox(account, archived);
  const threadOp = useThreadOp();
  const navigate = useNavigate();
  const [connectOpen, setConnectOpen] = useState(false);

  // First run: no accounts yet.
  if (!accountsLoading && accounts && accounts.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md text-center">
          <span
            className="mx-auto grid h-16 w-16 place-items-center rounded-2xl text-3xl"
            style={{ background: "linear-gradient(180deg, #4da3ff 0%, #1c7ef7 100%)" }}
          >
            ✉️
          </span>
          <h1 className="mt-5 text-[26px] font-bold tracking-tight text-zinc-900">
            Connect your first inbox
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-zinc-500">
            Gmail, iCloud, Porkbun, or any mailbox with IMAP. Your mail lands here in one clean
            list and replies always come from the right address.
          </p>
          <button className="btn-dark mt-6 px-7 py-3" onClick={() => setConnectOpen(true)}>
            Add account
          </button>
          <p className="mt-4 text-[13px] text-zinc-400">
            Takes about a minute. Passwords stored encrypted.
          </p>
        </div>
        {connectOpen && <ConnectAccountModal onClose={() => setConnectOpen(false)} />}
      </div>
    );
  }

  const all = inbox.data?.pages.flatMap((p) => p.threads) ?? [];
  const q = search.trim().toLowerCase();
  const threads = q
    ? all.filter((t) =>
        [t.subject, t.snippet, t.from_name, t.from_address, t.account_email, t.account_label]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(q)),
      )
    : all;
  const unread = threads.filter((t) => t.unread).length;
  const accountCount = accounts?.length ?? 0;
  const syncingFirstBatch = !inbox.isLoading && all.length === 0 && accountCount > 0 && !archived;

  const title = archived
    ? "Archived"
    : account
      ? (accounts?.find((a) => a.id === account)?.label ?? "Inbox")
      : "All inboxes";

  function openThread(t: ThreadSummary) {
    if (t.unread) threadOp.mutate({ threadId: t.id, op: "read" });
    navigate(`/t/${t.id}`);
  }

  return (
    <div className="flex h-full">
      {/* Message list pane */}
      <section
        className={`w-full flex-col border-r border-zinc-100 md:flex md:w-[400px] md:shrink-0 ${
          threadId ? "hidden" : "flex"
        }`}
        style={{ background: "#f7f9fb" }}
      >
        <div className="px-5 pb-3 pt-5">
          <h1 className="text-[22px] font-bold tracking-tight text-zinc-900">{title}</h1>
          <p className="mt-0.5 text-[13.5px] text-zinc-500">
            {q
              ? `${threads.length} result${threads.length === 1 ? "" : "s"} for "${search.trim()}"`
              : `${threads.length} conversation${threads.length === 1 ? "" : "s"}, ${unread} unread across ${accountCount} account${accountCount === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {inbox.isLoading ? (
            <ListSkeleton />
          ) : syncingFirstBatch ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">
              Syncing your recent mail. The first pass usually lands within a minute.
            </p>
          ) : threads.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">
              {q
                ? "Nothing matches your search."
                : archived
                  ? "Nothing archived yet."
                  : "You're at inbox zero. Enjoy it. 🎉"}
            </p>
          ) : (
            threads.map((t) => (
              <div
                key={t.id}
                className={`group relative mt-1 cursor-pointer rounded-xl px-3 py-3 transition ${
                  threadId === t.id ? "bg-[#dfeaff]" : "hover:bg-white"
                }`}
                onClick={() => openThread(t)}
              >
                <div className="flex gap-3">
                  <div className="relative shrink-0 pt-0.5">
                    {t.unread && (
                      <span className="absolute -left-2 top-4 h-1.5 w-1.5 rounded-full bg-[#1c7ef7]" />
                    )}
                    <span
                      className="grid h-10 w-10 place-items-center rounded-full text-[15px] font-semibold text-white"
                      style={{ background: t.account_color }}
                    >
                      {(senderLabel(t.from_name, t.from_address) || "?").charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-[14.5px] ${
                          t.unread ? "font-bold text-zinc-900" : "font-semibold text-zinc-700"
                        }`}
                      >
                        {senderLabel(t.from_name, t.from_address)}
                        {t.message_count > 1 && (
                          <span className="ml-1.5 text-[12px] font-normal text-zinc-400">
                            {t.message_count}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[12px] text-zinc-400">
                        {formatWhen(t.last_message_at)}
                      </span>
                    </div>
                    <div
                      className={`mt-0.5 truncate text-[13.5px] ${
                        t.unread ? "font-semibold text-zinc-800" : "text-zinc-600"
                      }`}
                    >
                      {t.subject || "(no subject)"}
                    </div>
                    {t.snippet && (
                      <div className="mt-0.5 truncate text-[13px] text-zinc-400">{t.snippet}</div>
                    )}
                    <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-zinc-500">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: t.account_color }}
                      />
                      {t.account_email}
                    </div>
                  </div>
                </div>

                {/* Hover actions */}
                <div
                  className="absolute right-2 top-2 hidden gap-1 group-hover:flex"
                  onClick={(e) => e.stopPropagation()}
                >
                  <RowButton
                    label={t.unread ? "Mark read" : "Mark unread"}
                    onClick={() =>
                      threadOp.mutate({ threadId: t.id, op: t.unread ? "read" : "unread" })
                    }
                  >
                    {t.unread ? "✓" : "●"}
                  </RowButton>
                  <RowButton
                    label={archived ? "Move to inbox" : "Archive"}
                    onClick={() =>
                      threadOp.mutate({ threadId: t.id, op: archived ? "unarchive" : "archive" })
                    }
                  >
                    {archived ? "↩" : "🗂"}
                  </RowButton>
                </div>
              </div>
            ))
          )}

          {inbox.hasNextPage && (
            <div className="py-3 text-center">
              <button
                className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-50"
                disabled={inbox.isFetchingNextPage}
                onClick={() => void inbox.fetchNextPage()}
              >
                {inbox.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Reading pane */}
      <section className={`min-w-0 flex-1 ${threadId ? "block" : "hidden md:block"}`}>
        <ReadingPane threadId={threadId ?? null} />
      </section>
    </div>
  );
}

function RowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-lg border border-zinc-200 bg-white text-xs text-zinc-500 shadow-sm hover:bg-zinc-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 px-2 pt-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl px-2 py-3">
          <div className="h-10 w-10 rounded-full bg-zinc-200/70" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 rounded bg-zinc-200/70" />
            <div className="h-3 w-full rounded bg-zinc-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
