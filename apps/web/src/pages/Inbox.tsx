import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { useAccounts, useBackfill, useDeleteThread, useInbox, useThreadOp } from "../lib/queries.js";
import { toast } from "../lib/toast.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { SenderAvatar } from "../components/SenderAvatar.js";
import { PaneResizer } from "../components/PaneResizer.js";
import { OnboardingWizard, onboardingSeen } from "../components/OnboardingWizard.js";
import { ReadingPane } from "./ThreadView.js";
import { MAIL_SRC } from "../lib/assets.js";
import type { AppOutletContext } from "../components/Layout.js";
import type { ThreadSummary } from "../lib/types.js";

export type InboxViewName = "all" | "starred" | "later" | "archived" | "deleted" | "sent";

const VIEW_TITLES: Record<InboxViewName, string> = {
  all: "All inboxes",
  starred: "Starred",
  later: "Read later",
  archived: "Archived",
  deleted: "Deleted",
  sent: "Sent",
};

// List-pane tabs: same views as the sidebar, but they keep the current
// account focus (sidebar views are global).
const TABS: Array<{ key: InboxViewName; label: string; path: string }> = [
  { key: "all", label: "Inbox", path: "/" },
  { key: "starred", label: "Starred", path: "/starred" },
  { key: "later", label: "Later", path: "/later" },
  { key: "sent", label: "Sent", path: "/sent" },
  { key: "archived", label: "Archived", path: "/archived" },
  { key: "deleted", label: "Deleted", path: "/deleted" },
];

// The mail surface: .dash-list (message rows) + .dash-read (reading pane).
// The selected thread lives in the ?t= query param so the view sticks.
export function Inbox({ view = "all" }: { view?: InboxViewName }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const account = params.get("account");
  const threadId = params.get("t");
  const { search } = useOutletContext<AppOutletContext>();
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  // Search is server-side across EVERY mailbox at once. Debounced so we
  // query on pauses, not every keystroke.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const searching = debouncedQ.length > 0;
  const inbox = useInbox(
    searching
      ? { q: debouncedQ }
      : {
          account,
          archived: view === "archived",
          starred: view === "starred",
          later: view === "later",
          deleted: view === "deleted",
          sent: view === "sent",
        },
  );
  const threadOp = useThreadOp();
  const deleteThread = useDeleteThread();

  // Infinite scroll. Watching a sentinel below the last row is cheaper and
  // steadier than a scroll handler, which fires constantly and has to
  // re-measure. rootMargin starts the fetch a screen early so the next page
  // is usually there before the user reaches the bottom.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = inbox;
  const backfill = useBackfill();
  // Set once the mail server says there is nothing older left (or the
  // storage ceiling is reached), so we stop asking on every scroll.
  const [noOlderMail, setNoOlderMail] = useState(false);
  useEffect(() => setNoOlderMail(false), [account, view]);

  // Backfill only makes sense for the main inbox: the other views filter
  // locally-set flags, so older mail from the server would not belong there.
  const canBackfill = view === "all" && !searching && !noOlderMail;

  const loadMore = useCallback(() => {
    if (hasNextPage) {
      if (!isFetchingNextPage) void fetchNextPage();
      return;
    }
    // Stored mail is exhausted: go ask the mail server for the next block.
    if (canBackfill && !backfill.isPending) {
      backfill.mutate(account, {
        onSuccess: (r) => {
          if (r.exhausted || r.added === 0) setNoOlderMail(true);
        },
        onError: () => setNoOlderMail(true),
      });
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, canBackfill, backfill, account]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root: el.closest(".list-rows"), rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // Re-observed when the sentinel remounts (new view) or paging state moves.
  }, [loadMore, view, account, debouncedQ]);
  // First-run onboarding: auto-open once for brand-new users (guarded below
  // so it only ever shows while zero accounts are connected).
  const [wizard, setWizard] = useState<null | "welcome" | "connect">(() =>
    onboardingSeen() ? null : "welcome",
  );

  // Mobile: the kit shows the reading pane as an overlay via a body class.
  useEffect(() => {
    document.body.classList.toggle("reading-open", Boolean(threadId));
    return () => document.body.classList.remove("reading-open");
  }, [threadId]);

  function openThread(t: ThreadSummary) {
    if (t.unread) threadOp.mutate({ threadId: t.id, op: "read" });
    const next = new URLSearchParams(params);
    next.set("t", t.id);
    setParams(next);
  }
  function closeThread() {
    const next = new URLSearchParams(params);
    next.delete("t");
    setParams(next);
  }

  // First run: no accounts connected yet.
  if (!accountsLoading && accounts && accounts.length === 0) {
    return (
      <section className="dash-read" style={{ display: "block" }}>
        <div className="empty-state">
          <img src={MAIL_SRC} alt="" />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>
              Connect your first inbox
            </div>
            <p style={{ marginTop: 8, maxWidth: 380, fontSize: 14, lineHeight: 1.6 }}>
              Gmail, iCloud, Porkbun, or any mailbox with IMAP. Your mail lands here in one clean
              list and replies always come from the right address.
            </p>
          </div>
          <button
            className="btn-black btn-auto"
            onClick={() => setWizard("connect")}
          >
            Add account
          </button>
          <p style={{ fontSize: 12.5 }}>Takes about a minute. Passwords stored encrypted.</p>
        </div>
        {wizard && <OnboardingWizard startAt={wizard} onClose={() => setWizard(null)} />}
      </section>
    );
  }

  // Server-side search already filtered across every mailbox; no client pass.
  const threads = inbox.data?.pages.flatMap((p) => p.threads) ?? [];
  const q = debouncedQ.toLowerCase();
  const unreadN = threads.filter((t) => t.unread).length;
  const accountsInView = new Set(threads.map((t) => t.account_id)).size;
  const syncingFirstBatch =
    !inbox.isLoading && threads.length === 0 && (accounts?.length ?? 0) > 0 && view === "all" && !q;

  const activeAcct = account ? accounts?.find((a) => a.id === account) : undefined;
  const title = searching ? "Search" : (activeAcct?.label ?? VIEW_TITLES[view]);

  function goTab(path: string) {
    const next = new URLSearchParams(params);
    next.delete("t");
    navigate({ pathname: path, search: next.toString() ? `?${next.toString()}` : "" });
  }

  return (
    <>
      {/* Single-account view washes the list pane in that account's color. */}
      <section
        className="dash-list"
        style={activeAcct ? { background: `color-mix(in srgb, ${activeAcct.color} 5%, #f6f7f9)` } : undefined}
      >
        <div className="list-head">
          <h2>{title}</h2>
          <p>
            {searching
              ? `${threads.length} result${threads.length === 1 ? "" : "s"} across every inbox for "${debouncedQ}"`
              : `${threads.length} message${threads.length === 1 ? "" : "s"}` +
                (threads.length
                  ? (unreadN ? `, ${unreadN} unread` : ", all read") +
                    ` across ${accountsInView} account${accountsInView === 1 ? "" : "s"}`
                  : "")}
          </p>
          {!searching && (
            <div className="list-tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`ltab ${view === t.key ? "on" : ""}`}
                  onClick={() => goTab(t.path)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="list-rows">
          {inbox.isLoading ? (
            <div className="empty-state" style={{ padding: "60px 20px" }}>
              <div>Loading your mail…</div>
            </div>
          ) : syncingFirstBatch ? (
            <div className="empty-state" style={{ padding: "60px 20px" }}>
              <img src={MAIL_SRC} alt="" />
              <div>Syncing your recent mail. The first pass usually lands within a minute.</div>
            </div>
          ) : threads.length === 0 ? (
            <div className="empty-state" style={{ padding: "60px 20px" }}>
              <img src={MAIL_SRC} alt="" />
              <div>
                {q
                  ? "Nothing matches that search in any inbox."
                  : view === "archived"
                    ? "Nothing archived yet."
                    : view === "starred"
                      ? "No starred messages yet."
                      : view === "later"
                        ? "Nothing saved for later."
                        : view === "deleted"
                          ? "Trash is empty. Deleted conversations stay here for 30 days."
                          : view === "sent"
                            ? "Nothing sent yet. Replies and new messages show up here."
                            : "You're at inbox zero. Enjoy it."}
              </div>
            </div>
          ) : (
            threads.map((t) => (
              <div
                key={t.id}
                className={`mrow ${t.unread ? "unread" : ""} ${threadId === t.id ? "sel" : ""}`}
                style={{ "--acc": t.account_color } as CSSProperties}
                onClick={() => openThread(t)}
              >
                {t.unread && <span className="unread-dot" style={{ background: t.account_color }} />}
                <SenderAvatar name={t.from_name} email={t.from_address} color={t.account_color} />
                <div className="body">
                  <div className="r1">
                    <span className="who">{senderLabel(t.from_name, t.from_address)}</span>
                    <span className="when">{formatWhen(t.last_message_at)}</span>
                  </div>
                  <div className="subj">{t.subject || "(no subject)"}</div>
                  {t.snippet && <div className="prev">{t.snippet}</div>}
                </div>
                <div className="acts" onClick={(e) => e.stopPropagation()}>
                  {view === "deleted" ? (
                    <button
                      className="act-btn"
                      title="Restore to inbox"
                      style={{ width: "auto", padding: "0 10px", fontWeight: 700 }}
                      onClick={() =>
                        threadOp.mutate(
                          { threadId: t.id, op: "restore" },
                          { onSuccess: () => toast("Conversation restored", "success") },
                        )
                      }
                    >
                      ↩ Restore
                    </button>
                  ) : (
                  <>
                  <button
                    className={`act-btn ${t.starred ? "on" : ""}`}
                    title={t.starred ? "Unstar" : "Star"}
                    onClick={() => threadOp.mutate({ threadId: t.id, op: t.starred ? "unstar" : "star" })}
                  >
                    ★
                  </button>
                  <button
                    className={`act-btn ${t.read_later ? "on" : ""}`}
                    title={t.read_later ? "Remove from read later" : "Read later"}
                    onClick={() => threadOp.mutate({ threadId: t.id, op: t.read_later ? "unlater" : "later" })}
                  >
                    ◷
                  </button>
                  <button
                    className="act-btn"
                    title={t.unread ? "Mark read" : "Mark unread"}
                    onClick={() => threadOp.mutate({ threadId: t.id, op: t.unread ? "read" : "unread" })}
                  >
                    {t.unread ? "✓" : "●"}
                  </button>
                  <button
                    className="act-btn"
                    title={t.archived ? "Move to inbox" : "Archive"}
                    onClick={() =>
                      threadOp.mutate({ threadId: t.id, op: t.archived ? "unarchive" : "archive" })
                    }
                  >
                    {t.archived ? "↩" : "🗂"}
                  </button>
                  <button
                    className="act-btn"
                    title="Delete from OneInbox"
                    onClick={() => {
                      deleteThread.mutate(t.id, { onSuccess: () => toast("Conversation deleted", "danger") });
                      if (threadId === t.id) closeThread();
                    }}
                  >
                    🗑
                  </button>
                  </>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Infinite scroll: this sentinel sits below the last row and pulls
              the next page as it comes into view. The button stays as a
              fallback for anyone who lands here without IntersectionObserver
              firing (and it shows the loading state). */}
          {(inbox.hasNextPage || canBackfill) && (
            <div ref={sentinelRef} style={{ padding: "14px 0", textAlign: "center" }}>
              <button
                className="btn-mini"
                disabled={inbox.isFetchingNextPage || backfill.isPending}
                onClick={loadMore}
              >
                {inbox.isFetchingNextPage
                  ? "Loading…"
                  : backfill.isPending
                    ? "Fetching older mail…"
                    : inbox.hasNextPage
                      ? "Load more"
                      : "Load older mail"}
              </button>
            </div>
          )}
        </div>
        <PaneResizer cssVar="--list-w" storageKey="oi-list-w" min={280} max={620} fallback={368} />
      </section>

      <section className="dash-read">
        <ReadingPane threadId={threadId} onBack={closeThread} />
      </section>

      {/* Keeps the onboarding wizard alive across the first connect (the
          first-run branch above unmounts the moment accounts exist). */}
      {wizard && <OnboardingWizard startAt={wizard} onClose={() => setWizard(null)} />}
    </>
  );
}
