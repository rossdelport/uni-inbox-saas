import { useEffect, useState, type CSSProperties } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { useAccounts, useDeleteThread, useInbox, useThreadOp } from "../lib/queries.js";
import { toast } from "../lib/toast.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { tint } from "../lib/colors.js";
import { OnboardingWizard, onboardingSeen } from "../components/OnboardingWizard.js";
import { ReadingPane } from "./ThreadView.js";
import { MAIL_SRC } from "../lib/assets.js";
import type { AppOutletContext } from "../components/Layout.js";
import type { ThreadSummary } from "../lib/types.js";

export type InboxViewName = "all" | "starred" | "later" | "archived";

const VIEW_TITLES: Record<InboxViewName, string> = {
  all: "All inboxes",
  starred: "Starred",
  later: "Read later",
  archived: "Archived",
};

// The mail surface: .dash-list (message rows) + .dash-read (reading pane).
// The selected thread lives in the ?t= query param so the view sticks.
export function Inbox({ view = "all" }: { view?: InboxViewName }) {
  const [params, setParams] = useSearchParams();
  const account = params.get("account");
  const threadId = params.get("t");
  const { search } = useOutletContext<AppOutletContext>();
  const { data: accounts, isLoading: accountsLoading } = useAccounts();
  const inbox = useInbox({
    account,
    archived: view === "archived",
    starred: view === "starred",
    later: view === "later",
  });
  const threadOp = useThreadOp();
  const deleteThread = useDeleteThread();
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
            className="btn-black"
            style={{ width: "auto", padding: "0 34px", height: 48, fontSize: 15 }}
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

  const all = inbox.data?.pages.flatMap((p) => p.threads) ?? [];
  const q = search.trim().toLowerCase();
  const threads = q
    ? all.filter((t) =>
        [t.subject, t.snippet, t.from_name, t.from_address, t.account_email, t.account_label]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(q)),
      )
    : all;
  const unreadN = threads.filter((t) => t.unread).length;
  const accountsInView = new Set(threads.map((t) => t.account_id)).size;
  const syncingFirstBatch =
    !inbox.isLoading && all.length === 0 && (accounts?.length ?? 0) > 0 && view === "all" && !q;

  const activeAcct = account ? accounts?.find((a) => a.id === account) : undefined;
  const title = view === "all" && account ? (activeAcct?.label ?? "Inbox") : VIEW_TITLES[view];

  return (
    <>
      {/* Single-account view washes the list pane in that account's color. */}
      <section
        className="dash-list"
        style={activeAcct ? { background: `${activeAcct.color}0e` } : undefined}
      >
        <div className="list-head">
          <h2>{title}</h2>
          <p>
            {q
              ? `${threads.length} result${threads.length === 1 ? "" : "s"} for "${search.trim()}"`
              : `${threads.length} message${threads.length === 1 ? "" : "s"}` +
                (threads.length
                  ? (unreadN ? `, ${unreadN} unread` : ", all read") +
                    ` across ${accountsInView} account${accountsInView === 1 ? "" : "s"}`
                  : "")}
          </p>
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
                  ? "Nothing matches that search."
                  : view === "archived"
                    ? "Nothing archived yet."
                    : view === "starred"
                      ? "No starred messages yet."
                      : view === "later"
                        ? "Nothing saved for later."
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
                <div className="ava" style={tint(t.account_color)}>
                  {(senderLabel(t.from_name, t.from_address) || "?").charAt(0).toUpperCase()}
                </div>
                <div className="body">
                  <div className="r1">
                    <span className="who">{senderLabel(t.from_name, t.from_address)}</span>
                    <span className="when">{formatWhen(t.last_message_at)}</span>
                  </div>
                  <div className="subj">{t.subject || "(no subject)"}</div>
                  {t.snippet && <div className="prev">{t.snippet}</div>}
                </div>
                <div className="acts" onClick={(e) => e.stopPropagation()}>
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
                      if (!window.confirm("Delete this conversation from OneInbox? Your real mailbox is untouched.")) return;
                      deleteThread.mutate(t.id, { onSuccess: () => toast("Conversation deleted", "danger") });
                      if (threadId === t.id) closeThread();
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))
          )}

          {inbox.hasNextPage && (
            <div style={{ padding: "14px 0", textAlign: "center" }}>
              <button
                className="btn-mini"
                disabled={inbox.isFetchingNextPage}
                onClick={() => void inbox.fetchNextPage()}
              >
                {inbox.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
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
