import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
  useAccounts,
  useBackfill,
  useCancelOutbox,
  useDeleteThread,
  useInbox,
  useReadAll,
  useScheduledSends,
  useThreadOp,
} from "../lib/queries.js";
import { toast } from "../lib/toast.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { KP, useHotkeys } from "../lib/keyboard.js";
import { composerDirty } from "../lib/composerIntent.js";
import { SenderAvatar } from "../components/SenderAvatar.js";
import { PaneResizer } from "../components/PaneResizer.js";
import { SnoozePicker } from "../components/SnoozePicker.js";
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

// The mail surface: .dash-list (message rows) + .dash-read (reading pane).
// The selected thread lives in the ?t= query param so the view sticks.
export function Inbox({ view = "all" }: { view?: InboxViewName }) {
  const [params, setParams] = useSearchParams();
  const account = params.get("account");
  const threadId = params.get("t");
  // Split chip, plain Inbox only. Lives in the URL so a refresh or a shared
  // link keeps the pile you were looking at; anything unrecognised is "all".
  const rawSplit = params.get("split");
  const split =
    view === "all" && (rawSplit === "important" || rawSplit === "newsletter" || rawSplit === "other")
      ? rawSplit
      : null;
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
          split,
        },
  );
  const threadOp = useThreadOp();
  const deleteThread = useDeleteThread();

  // Infinite scroll. Watching a sentinel below the last row is cheaper and
  // steadier than a scroll handler, which fires constantly and has to
  // re-measure. rootMargin starts the fetch a screen early so the next page
  // is usually there before the user reaches the bottom.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = inbox;
  const backfill = useBackfill();
  const readAll = useReadAll();
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

  // Paging is deliberately manual. Auto-loading on scroll meant the list had
  // no bottom: you could never tell whether you had reached the end of your
  // mail or simply the end of what had been fetched so far, and each new block
  // is a real IMAP round trip, not just a page of rows already in hand.
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

  // ── Keyboard cursor ──────────────────────────────────────────────────
  // -1 = no cursor drawn: the outline appears only once the keyboard (or a
  // row click) places it, so mouse-first users never see a stray highlight.
  const threads = inbox.data?.pages.flatMap((p) => p.threads) ?? [];
  const selectedThread = threads.find((thread) => thread.id === threadId);
  const [cur, setCur] = useState(-1);
  const rowEls = useRef<Array<HTMLDivElement | null>>([]);
  const [kbSnooze, setKbSnooze] = useState<{ threadId: string; anchor: DOMRect } | null>(null);
  useEffect(() => setCur(-1), [view, account, split, searching]);
  // Archive and delete remove their row optimistically, so the next row
  // slides into the cursor index by itself; this only catches the end.
  useEffect(() => {
    if (cur >= threads.length && threads.length > 0) setCur(threads.length - 1);
  }, [cur, threads.length]);
  useEffect(() => {
    if (cur >= 0) rowEls.current[cur]?.scrollIntoView({ block: "nearest" });
  }, [cur]);

  // Switching the open thread remounts the reading pane (it is keyed on
  // threadId), which destroys any reply typed into it. Refuse to move on.
  function guardDraft(): boolean {
    if (!composerDirty()) return false;
    toast("You have an unsent reply. Send it or clear it first.", "warn");
    return true;
  }
  function moveCursor(delta: number) {
    if (threads.length === 0) return;
    const next = cur < 0 ? 0 : Math.min(threads.length - 1, Math.max(0, cur + delta));
    // With the reading pane open, j/k walk the conversations themselves.
    const t = threads[next];
    if (threadId && t && t.id !== threadId) {
      if (guardDraft()) return;
      openThread(t);
    }
    setCur(next);
  }
  function openCursor() {
    const t = threads[cur >= 0 ? cur : 0];
    if (!t) return false as const;
    if (threadId && t.id !== threadId && guardDraft()) return;
    if (cur < 0) setCur(0);
    openThread(t);
  }
  /** Run fn on the cursor row; declines the key when there is none. */
  function withCursor(fn: (t: ThreadSummary, el: HTMLDivElement | null) => void) {
    const t = cur >= 0 ? threads[cur] : undefined;
    if (!t) return false as const;
    fn(t, rowEls.current[cur] ?? null);
  }

  // Cursor movement never fires read POSTs (only opening does), so holding j
  // to skim a list cannot mark it read behind you.
  useHotkeys(
    {
      j: () => moveCursor(1),
      k: () => moveCursor(-1),
      Enter: () => openCursor(),
      o: () => openCursor(),
      e: () =>
        withCursor((t) =>
          threadOp.mutate(
            view === "deleted"
              ? { threadId: t.id, op: "restore" }
              : { threadId: t.id, op: t.archived ? "unarchive" : "archive" },
          ),
        ),
      s: () =>
        withCursor((t) => threadOp.mutate({ threadId: t.id, op: t.starred ? "unstar" : "star" })),
      h: () =>
        withCursor((t, el) => {
          if (t.read_later || t.snooze_until) threadOp.mutate({ threadId: t.id, op: "unlater" });
          else if (el) setKbSnooze({ threadId: t.id, anchor: el.getBoundingClientRect() });
        }),
      "#": () => {
        // Deleted view offers Restore only; "#" matching the rows it sits on.
        if (view === "deleted") return false;
        return withCursor((t) => {
          deleteThread.mutate(t.id, { onSuccess: () => toast("Conversation deleted", "danger") });
          if (threadId === t.id) closeThread();
        });
      },
      u: () => (threadId ? closeThread() : false),
      Escape: () => (threadId ? closeThread() : false),
    },
    { priority: KP.list },
  );

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
          {/* No button here on purpose. The sidebar already has Add account,
              and with no inboxes connected every sidebar item opens the same
              modal, so a second button in the middle of the pane was just
              floating clutter. */}
          <p style={{ fontSize: 12.5 }}>
            Pick <b>Add account</b> in the sidebar to connect one. Takes about a minute, and
            passwords are stored encrypted.
          </p>
        </div>
        {wizard && <OnboardingWizard startAt={wizard} onClose={() => setWizard(null)} />}
      </section>
    );
  }

  // Server-side search already filtered across every mailbox; no client pass.
  const q = debouncedQ.toLowerCase();
  const unreadN = threads.filter((t) => t.unread).length;
  const accountsInView = new Set(threads.map((t) => t.account_id)).size;
  const syncingFirstBatch =
    !inbox.isLoading && threads.length === 0 && (accounts?.length ?? 0) > 0 && view === "all" && !q;

  const activeAcct = account ? accounts?.find((a) => a.id === account) : undefined;
  const title = searching ? "Search" : (activeAcct?.label ?? VIEW_TITLES[view]);

  function goSplit(next_split: string | null) {
    const next = new URLSearchParams(params);
    next.delete("t"); // switching pile closes the open thread, like a tab switch
    if (next_split) next.set("split", next_split);
    else next.delete("split");
    setParams(next);
  }

  return (
    <>
      {/* Single-account view washes the list pane in that account's color. */}
      <section
        className="dash-list"
        style={activeAcct ? { background: `color-mix(in srgb, ${activeAcct.color} 5%, #f6f7f9)` } : undefined}
      >
        <div className="list-head">
          <div className="list-head-top">
            <h2>{title}</h2>
            {/* Only when there is something to clear, and never over search
                results, where "all" would mean more than what is listed.
                Hidden on Sent and Deleted as well: the request carries no scope
                for either view, so it degrades to the plain Inbox scope and
                would mark the whole inbox read from a tab that is not showing
                it. Mobile already guards this; web did not. */}
            {unreadN > 0 && !searching && view !== "sent" && view !== "deleted" && (
              <button
                className="btn-mini"
                disabled={readAll.isPending}
                onClick={() =>
                  readAll.mutate(
                    { account, archived: view === "archived", starred: view === "starred", later: view === "later", split },
                    {
                      onSuccess: (r) =>
                        toast(
                          r.remaining
                            ? `Marked ${r.marked} read. Press again for the rest.`
                            : `Marked ${r.marked} read.`,
                          "success",
                        ),
                      onError: () => toast("Could not mark everything read.", "warn"),
                    },
                  )
                }
              >
                {readAll.isPending ? "Marking…" : "Read all"}
              </button>
            )}
          </div>
          <p>
            {searching
              ? `${threads.length} result${threads.length === 1 ? "" : "s"} across every inbox for "${debouncedQ}"`
              : `${threads.length} message${threads.length === 1 ? "" : "s"}` +
                (threads.length
                  ? (unreadN ? `, ${unreadN} unread` : ", all read") +
                    ` across ${accountsInView} account${accountsInView === 1 ? "" : "s"}`
                  : "")}
          </p>
          {/* Mail categories stay here; mailbox views already live in the
              sidebar, so repeating them in this drawer adds noise. */}
          {!searching && view === "all" && (
            <div className="split-strip">
              {(
                [
                  { key: null, label: "All" },
                  { key: "important", label: "Important" },
                  { key: "newsletter", label: "Newsletters" },
                  { key: "other", label: "Other" },
                ] as Array<{ key: string | null; label: string }>
              ).map((c) => (
                <button
                  key={c.label}
                  className={`schip ${split === c.key ? "on" : ""}`}
                  onClick={() => goSplit(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Keyed on what you switched to, so changing tab or account replays
            the entrance and resets the scroll to the top of the new list. */}
        <div className="list-rows rise" key={`${view}:${account ?? "all"}:${split ?? "all"}`}>
          {view === "sent" && !searching && <ScheduledStrip />}
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
            threads.map((t, i) => (
              <div
                key={t.id}
                ref={(el) => {
                  rowEls.current[i] = el;
                }}
                className={`mrow ${t.unread ? "unread" : ""} ${threadId === t.id ? "sel" : ""} ${cur === i ? "cur" : ""}`}
                style={{ "--acc": t.account_color } as CSSProperties}
                onClick={() => {
                  setCur(i);
                  openThread(t);
                }}
              >
                {t.unread && <span className="unread-dot" style={{ background: t.account_color }} />}
                <SenderAvatar name={t.from_name} email={t.from_address} color={t.account_color} />
                <div className="body">
                  <div className="r1">
                    <span className="who">{senderLabel(t.from_name, t.from_address)}</span>
                    {/* In the Snoozed view the useful time is when it comes
                        BACK, not when it last moved. A wake time in the past
                        (the up-to-60s window before the sweep tidies it) reads
                        "back now" rather than a stale countdown. */}
                    {view === "later" && t.snooze_until ? (
                      <span className="when snz-when">
                        {new Date(t.snooze_until).getTime() <= Date.now()
                          ? "back now"
                          : `back ${formatWhen(t.snooze_until)}`}
                      </span>
                    ) : (
                      <span className="when">{formatWhen(t.last_message_at)}</span>
                    )}
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

          {/* The foot of the list. Generous space above and below on purpose:
              it has to read as a deliberate end rather than the list being
              clipped, whether there is more to fetch or not. */}
          {threads.length > 0 &&
            ((inbox.hasNextPage || canBackfill) ? (
              <div className="list-foot">
                <button
                  className="btn-ghost"
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
            ) : (
              <div className="list-foot">
                <span className="list-end">That's all your mail</span>
              </div>
            ))}
        </div>
        <PaneResizer cssVar="--list-w" storageKey="oi-list-w" min={280} max={620} fallback={368} />
      </section>

      <section
        className={`dash-read ${selectedThread ? "thread-selected" : ""}`}
        key={threadId ?? "empty"}
        style={
          selectedThread
            ? ({ "--thread-accent": selectedThread.account_color } as CSSProperties)
            : undefined
        }
      >
        <ReadingPane threadId={threadId} onBack={closeThread} />
      </section>

      {/* Keeps the onboarding wizard alive across the first connect (the
          first-run branch above unmounts the moment accounts exist). */}
      {wizard && <OnboardingWizard startAt={wizard} onClose={() => setWizard(null)} />}

      {/* Snooze picker for the keyboard cursor ("h"), anchored to its row. */}
      {kbSnooze && (
        <SnoozePicker
          threadId={kbSnooze.threadId}
          anchor={kbSnooze.anchor}
          onClose={() => setKbSnooze(null)}
        />
      )}
    </>
  );
}

// Scheduled sends, pinned above the Sent list: mail that exists only as an
// outbox row until the worker delivers it. Cancel returns it to nowhere (a
// scheduled compose has no thread yet), which is exactly what cancel means.
function ScheduledStrip() {
  const { data } = useScheduledSends(true);
  const cancel = useCancelOutbox();
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div className="obx" style={{ margin: "4px 4px 10px" }}>
      {items.map((i) => (
        <div key={i.id} className="obx-row queued">
          <span className="obx-dot" aria-hidden="true" />
          <span className="obx-text">
            To {i.to.join(", ")}{i.subject ? ` · ${i.subject}` : ""} · sends{" "}
            {new Date(i.not_before).toLocaleString()}
          </span>
          <button
            className="btn-mini"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(i.id, {
                onSuccess: () => toast("Scheduled send cancelled.", "success"),
                onError: (e) => toast((e as Error).message, "warn"),
              })
            }
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}
