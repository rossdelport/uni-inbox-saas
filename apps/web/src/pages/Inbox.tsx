import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAccounts, useInbox, useThreadOp } from "../lib/queries.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { AccountBadge } from "../components/AccountBadge.js";
import { ConnectAccountModal } from "../components/ConnectAccountModal.js";
import { useState } from "react";

// The unified list. Row anatomy: color dot, sender, subject + snippet, time.
// Unread rows are bold; hover reveals archive / read toggles.
export function Inbox({ archived = false }: { archived?: boolean }) {
  const [params] = useSearchParams();
  const account = params.get("account");
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const inbox = useInbox(account, archived);
  const threadOp = useThreadOp();
  const navigate = useNavigate();
  const [connectOpen, setConnectOpen] = useState(false);

  // First-run: no accounts yet -> connect flow front and center.
  if (!accountsLoading && accounts && accounts.length === 0) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <div className="text-xl font-semibold">Connect your first inbox</div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            Add Gmail, a Porkbun mailbox, or any IMAP account. Your mail shows up here
            in one clean list, color-coded per project.
          </p>
          <button className="btn mt-5" onClick={() => setConnectOpen(true)}>
            Connect an inbox
          </button>
        </div>
        {connectOpen && <ConnectAccountModal onClose={() => setConnectOpen(false)} />}
      </div>
    );
  }

  const threads = inbox.data?.pages.flatMap((p) => p.threads) ?? [];
  const syncingFirstBatch =
    !inbox.isLoading && threads.length === 0 && (accounts?.length ?? 0) > 0 && !archived;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {archived ? "Archived" : account ? accounts?.find((a) => a.id === account)?.label : "Inbox"}
        </h1>
        {inbox.isFetching && <span className="text-xs text-zinc-400">Syncing…</span>}
      </div>

      {inbox.isLoading ? (
        <ListSkeleton />
      ) : syncingFirstBatch ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          Syncing your recent mail. The first pass usually lands within a minute.
        </div>
      ) : threads.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
          {archived ? "Nothing archived yet." : "You're at inbox zero. Enjoy it."}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {threads.map((t) => (
            <li
              key={t.id}
              className="group flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-zinc-50"
              onClick={() => {
                if (t.unread) threadOp.mutate({ threadId: t.id, op: "read" });
                navigate(`/t/${t.id}`);
              }}
            >
              <span title={t.account_label}>
                <AccountBadge color={t.account_color} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`truncate text-sm ${t.unread ? "font-semibold" : "text-zinc-700"}`}
                  >
                    {senderLabel(t.from_name, t.from_address)}
                  </span>
                  {t.message_count > 1 && (
                    <span className="text-xs text-zinc-400">{t.message_count}</span>
                  )}
                </div>
                <div className="truncate text-sm">
                  <span className={t.unread ? "font-medium" : "text-zinc-600"}>
                    {t.subject || "(no subject)"}
                  </span>
                  {t.snippet && <span className="text-zinc-400"> — {t.snippet}</span>}
                </div>
              </div>
              <span className="shrink-0 text-xs text-zinc-400">{formatWhen(t.last_message_at)}</span>
              <div
                className="hidden shrink-0 gap-1 group-hover:flex"
                onClick={(e) => e.stopPropagation()}
              >
                <RowButton
                  label={t.unread ? "Mark read" : "Mark unread"}
                  onClick={() => threadOp.mutate({ threadId: t.id, op: t.unread ? "read" : "unread" })}
                >
                  {t.unread ? "✓" : "●"}
                </RowButton>
                <RowButton
                  label={archived ? "Move to inbox" : "Archive"}
                  onClick={() =>
                    threadOp.mutate({ threadId: t.id, op: archived ? "unarchive" : "archive" })
                  }
                >
                  {archived ? "↩" : "⌄"}
                </RowButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {inbox.hasNextPage && (
        <div className="mt-4 text-center">
          <button
            className="btn-ghost"
            disabled={inbox.isFetchingNextPage}
            onClick={() => void inbox.fetchNextPage()}
          >
            {inbox.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      <p className="mt-6 text-center">
        <Link to="/accounts" className="text-xs text-zinc-400 hover:text-zinc-600">
          Manage connected inboxes
        </Link>
      </p>
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
      className="grid h-7 w-7 place-items-center rounded-md border border-zinc-200 bg-white text-xs text-zinc-500 hover:bg-zinc-100"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-px overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="h-2 w-2 rounded-full bg-zinc-200" />
          <div className="h-3 w-32 rounded bg-zinc-100" />
          <div className="h-3 flex-1 rounded bg-zinc-50" />
          <div className="h-3 w-8 rounded bg-zinc-100" />
        </div>
      ))}
    </div>
  );
}
