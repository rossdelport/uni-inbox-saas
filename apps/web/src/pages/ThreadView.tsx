import { useRef, useState } from "react";
import {
  useAccounts,
  useAiSummary,
  useBillingState,
  useCancelOutbox,
  useDeleteThread,
  useForward,
  useOutboxForThread,
  useSummarize,
  useThread,
  useThreadOp,
} from "../lib/queries.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { KP, useHotkeys } from "../lib/keyboard.js";
import { composerDirty, requestReply } from "../lib/composerIntent.js";
import { MessageBody } from "../components/MessageBody.js";
import { ContactAutocompleteInput } from "../components/ContactAutocompleteInput.js";
import { SenderAvatar } from "../components/SenderAvatar.js";
import { ReplyComposer } from "../components/ReplyComposer.js";
import { SnoozePicker } from "../components/SnoozePicker.js";
import { SplitPicker } from "../components/SplitPicker.js";
import { MAIL_SRC } from "../lib/assets.js";
import { toast } from "../lib/toast.js";
import type { Message } from "../lib/types.js";

// The reading pane (.read-wrap): via chips, action chips, big subject,
// sender rows, message bodies and the reply composer.
export function ReadingPane({ threadId, onBack }: { threadId: string | null; onBack: () => void }) {
  const { data, isLoading, error } = useThread(threadId);
  const { data: allAccounts } = useAccounts();
  const threadOp = useThreadOp();
  const deleteThread = useDeleteThread();
  // Toggled message ids. The latest message defaults open, older ones closed;
  // a toggle flips whichever default applies (so the last one can collapse too).
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [showEarlier, setShowEarlier] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeChipRef = useRef<HTMLButtonElement>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const splitChipRef = useRef<HTMLButtonElement>(null);

  // Keys for the open conversation. Above the list's priority: with a thread
  // showing, "e" archives THIS thread and goes back, not the cursor row.
  const th = data?.thread;
  // Leaving this pane unmounts the reply composer, and a typed reply lives
  // only in its contentEditable: closing would destroy it silently. Any key
  // that navigates away refuses while there is unsent content.
  function guardDraft(): boolean {
    if (!composerDirty()) return false;
    toast("You have an unsent reply. Send it or clear it first.", "warn");
    return true;
  }
  useHotkeys(
    {
      r: () => {
        if (!requestReply()) return false;
      },
      e: () => {
        if (!th) return false;
        if (guardDraft()) return;
        threadOp.mutate({ threadId: th.id, op: th.archived ? "unarchive" : "archive" });
      },
      s: () => {
        if (!th) return false;
        threadOp.mutate({ threadId: th.id, op: th.starred ? "unstar" : "star" });
      },
      h: () => {
        if (!th) return false;
        if (th.read_later || th.snooze_until) threadOp.mutate({ threadId: th.id, op: "unlater" });
        else setSnoozeOpen(true);
      },
      "#": () => {
        if (!th) return false;
        if (guardDraft()) return;
        deleteThread.mutate(th.id, { onSuccess: () => toast("Conversation deleted", "danger") });
      },
      u: () => {
        if (guardDraft()) return;
        onBack();
      },
      Escape: () => {
        if (forwardOpen) setForwardOpen(false);
        else if (!guardDraft()) onBack();
      },
    },
    { active: Boolean(threadId && th), priority: KP.pane },
  );

  if (!threadId) {
    return (
      <div className="empty-state">
        <img src={MAIL_SRC} alt="" />
        <div>Select a message to read.</div>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="empty-state">
        <div>Loading…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="empty-state">
        <div>
          Thread not found.{" "}
          <button style={{ color: "var(--b1-ink)", fontWeight: 600 }} onClick={onBack}>
            Back to the list
          </button>
        </div>
      </div>
    );
  }

  const { thread, messages } = data;
  const signatureHtml =
    allAccounts?.find((a) => a.email_address === thread.account_email)?.signature_html ?? null;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  // Lock the older messages only during the live handoff. Once the reply is
  // Sent, normal toggling returns so the user can reopen the email they just
  // answered (the previous version kept it locked forever).
  const replyHandoff =
    last?.direction === "outbound" &&
    (last.client_delivery_state === "sending" ||
      (last.id.startsWith("optimistic-") && !last.client_delivery_state));
  const replyingToId = replyHandoff ? messages[lastIdx - 1]?.id : null;
  const replyTo =
    last?.direction === "outbound" ? "them" : senderLabel(last?.from_name ?? null, last?.from_address ?? null);

  return (
    <div className="read-wrap">
      <div className="read-scroll">
      <button className="read-back" onClick={onBack}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back
      </button>

      <div className="via-chips">
        <span className="chip">
          <i style={{ background: thread.account_color }} />
          via {thread.account_label}
        </span>
        <span className="chip">to {thread.account_email}</span>
        <button
          ref={splitChipRef}
          className="chip split-chip"
          title={thread.split_reason ?? "Category reason unavailable"}
          onClick={() => setSplitOpen((open) => !open)}
        >
          <span className={`split-dot ${thread.split_class}`} />
          {thread.split_class === "newsletter" ? "Newsletter" : thread.split_class === "other" ? "Other" : "Important"}
        </button>
        {splitOpen && splitChipRef.current && (
          <SplitPicker
            threadId={thread.id}
            sender={thread.from_address}
            reason={thread.split_reason}
            anchor={splitChipRef.current.getBoundingClientRect()}
            onClose={() => setSplitOpen(false)}
          />
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="chip" onClick={() => setForwardOpen((v) => !v)}>
            ↪ Forward
          </button>
          <button
            className={`chip ${thread.starred ? "on" : ""}`}
            onClick={() => threadOp.mutate({ threadId: thread.id, op: thread.starred ? "unstar" : "star" })}
          >
            ★ {thread.starred ? "Starred" : "Star"}
          </button>
          <button
            ref={snoozeChipRef}
            className={`chip ${thread.read_later || thread.snooze_until ? "on" : ""}`}
            onClick={() => {
              // Already snoozed or saved: one tap brings it back (unlater
              // clears both states). Otherwise open the picker.
              if (thread.read_later || thread.snooze_until) {
                threadOp.mutate({ threadId: thread.id, op: "unlater" });
              } else {
                setSnoozeOpen(true);
              }
            }}
          >
            ◷ {thread.snooze_until ? "Snoozed" : thread.read_later ? "Saved" : "Snooze"}
          </button>
          {snoozeOpen && snoozeChipRef.current && (
            <SnoozePicker
              threadId={thread.id}
              anchor={snoozeChipRef.current.getBoundingClientRect()}
              onClose={() => setSnoozeOpen(false)}
            />
          )}
          <button
            className="chip"
            onClick={() => {
              threadOp.mutate({
                threadId: thread.id,
                op: thread.archived ? "unarchive" : "archive",
              });
            }}
          >
            {thread.archived ? "↩ Unarchive" : "🗂 Archive"}
          </button>
          <button
            className="chip"
            onClick={() => {
              deleteThread.mutate(thread.id, { onSuccess: () => toast("Conversation deleted", "danger") });
            }}
          >
            🗑 Delete
          </button>
        </span>
      </div>

      <h1>{thread.subject || "(no subject)"}</h1>

      <AiSummaryBlock threadId={thread.id} />

      {forwardOpen && (
        <ForwardBox
          threadId={thread.id}
          accountEmail={thread.account_email}
          onDone={() => setForwardOpen(false)}
        />
      )}

      <div className="gm-thread">
        {messages.map((m, i) => {
          // Long threads: keep the first message, collapse the middle into a
          // pill, always show the last three (Gmail's stacking behavior).
          const hidden = messages.length > 6 && !showEarlier && i > 0 && i < messages.length - 3;
          if (hidden) {
            if (i !== 1) return null;
            return (
              <button key="gm-older" className="gm-older" onClick={() => setShowEarlier(true)}>
                Show {messages.length - 4} earlier message{messages.length - 4 === 1 ? "" : "s"}
              </button>
            );
          }
          const isLast = i === lastIdx;
          // A reply always closes the message it answers. Keeping this
          // explicit means a stale refresh cannot reopen that message while
          // the optimistic outgoing card is changing to Sent.
          const open = replyHandoff
            ? isLast
            : m.id === replyingToId
              ? false
              : isLast !== toggled.has(m.id);
          return (
            <GmMessage
              key={m.id}
              m={m}
              open={open}
              accountColor={thread.account_color}
              accountLabel={thread.account_label}
              accountEmail={thread.account_email}
              onToggle={() =>
                setToggled((prev) => {
                  const next = new Set(prev);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  return next;
                })
              }
            />
          );
        })}
      </div>

      <OutboxStrip threadId={thread.id} />
      </div>

      <ReplyComposer
        threadId={thread.id}
        replyTo={replyTo}
        accountEmail={thread.account_email}
        signatureHtml={signatureHtml}
      />
    </div>
  );
}

// Sends still in motion for this conversation: queued (undo window or
// scheduled), sending, and the two states that need a human (failed,
// unknown). Sent rows vanish on their own: the delivered message replaces
// them in the thread.
function OutboxStrip({ threadId }: { threadId: string }) {
  const { data } = useOutboxForThread(threadId);
  const cancel = useCancelOutbox();
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="obx">
      {items.map((i) => {
        const scheduled = i.status === "queued" && new Date(i.not_before).getTime() > Date.now() + 60_000;
        const label =
          i.status === "queued"
            ? scheduled
              ? `Scheduled: sends ${new Date(i.not_before).toLocaleString()}`
              : "Sending shortly…"
            : i.status === "sending"
              ? "Sending…"
              : i.status === "unknown"
                ? (i.last_error ?? "We could not confirm this send.")
                : (i.last_error ?? "This send failed.");
        return (
          <div key={i.id} className={`obx-row ${i.status}`}>
            <span className="obx-dot" aria-hidden="true" />
            <span className="obx-text">{label}</span>
            {i.status === "queued" && (
              <button
                className="btn-mini"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(i.id, {
                    onSuccess: () => toast(scheduled ? "Scheduled send cancelled." : "Send cancelled.", "success"),
                    onError: (e) => toast((e as Error).message, "warn"),
                  })
                }
              >
                {scheduled ? "Cancel" : "Undo"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// AI summary strip, add-on subscribers only. Reads the server cache for free;
// the button is the one thing that spends a paid call. When new mail lands the
// cache goes stale server-side, the GET returns null again and the button
// reappears, so freshness needs no client bookkeeping. Deliberately absent for
// non-subscribers: the pitch lives on the Billing page, not as a nag here.
function AiSummaryBlock({ threadId }: { threadId: string }) {
  const { data: billing } = useBillingState();
  const enabled = Boolean(billing?.ai_addon);
  const { data } = useAiSummary(threadId, enabled);
  const summarize = useSummarize();
  const s = data?.summary ?? null;
  // Superhuman's "I": one key summarizes the open thread, pressing it again
  // tucks the summary away. Add-on subscribers only; for everyone else the
  // binding is inactive so "i" stays a dead key, not a nag. Hidden state
  // resets per thread because the whole pane is keyed on threadId.
  const [hidden, setHidden] = useState(false);
  useHotkeys(
    {
      i: () => {
        if (s) setHidden((v) => !v);
        else if (!summarize.isPending)
          summarize.mutate(threadId, { onError: (e) => toast((e as Error).message, "warn") });
      },
    },
    { active: enabled, priority: KP.pane },
  );
  if (!enabled) return null;
  if (hidden) return null;

  return (
    <div className="ai-sum">
      <svg
        className="ai-spark"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" />
        <path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z" opacity=".7" />
      </svg>
      {s ? (
        <p>{s.summary}</p>
      ) : (
        <button
          className="btn-mini"
          disabled={summarize.isPending}
          onClick={() =>
            summarize.mutate(threadId, {
              onError: (e) => toast((e as Error).message, "warn"),
            })
          }
        >
          {summarize.isPending ? "Summarizing…" : "Summarize this conversation"}
        </button>
      )}
    </div>
  );
}

// Inline forward panel: recipients + optional note; the latest message goes
// out quoted Gmail-style, sent from the thread's account.
function ForwardBox({
  threadId,
  accountEmail,
  onDone,
}: {
  threadId: string;
  accountEmail: string;
  onDone: () => void;
}) {
  const forward = useForward();
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const recipients = to
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));

  function send() {
    if (recipients.length === 0) return;
    forward.mutate(
      { threadId, to: recipients, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast(`Forwarded from ${accountEmail}`, "success");
          onDone();
        },
      },
    );
  }

  return (
    <div className="read-reply" style={{ margin: "0 0 16px" }}>
      <div className="field" style={{ marginTop: 0 }}>
        <label>Forward to</label>
        <ContactAutocompleteInput
          autoFocus
          placeholder="name@example.com, other@example.com"
          value={to}
          onChange={setTo}
        />
      </div>
      <div className="field">
        <label>Add a note (optional)</label>
        <textarea
          style={{ minHeight: 54 }}
          placeholder="FYI..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {forward.error && <p className="err">{(forward.error as Error).message}</p>}
      <div className="rr-bar">
        <span className="rr-note">Latest message, quoted. Sends from {accountEmail}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="btn-mini" onClick={onDone}>
            Cancel
          </button>
          <button
            className="btn-sm"
            disabled={forward.isPending || recipients.length === 0}
            onClick={send}
          >
            {forward.isPending ? "Sending…" : "Forward"}
          </button>
        </span>
      </div>
    </div>
  );
}

type DeliveryState = NonNullable<Message["client_delivery_state"]>;

/** A small vertical text roll that keeps the outgoing row's height fixed. */
function DeliveryStatus({ state }: { state: DeliveryState }) {
  return (
    <span
      className={`delivery-status ${state === "sent" ? "is-sent" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={state === "sent" ? "Sent" : "Sending"}
    >
      <span className="delivery-label delivery-sending">Sending…</span>
      <span className="delivery-label delivery-sent">Sent</span>
    </span>
  );
}

async function copyEmailAddress(address: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(address);
      toast("Email address copied", "success");
      return;
    }
    throw new Error("Clipboard API unavailable");
  } catch {
    // Keep copy working in browsers where the Clipboard API is unavailable.
    const textarea = document.createElement("textarea");
    textarea.value = address;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (!document.execCommand("copy")) throw new Error("Copy failed");
      toast("Email address copied", "success");
    } catch {
      toast("Could not copy the email address", "warn");
    } finally {
      textarea.remove();
    }
  }
}

function CopyAddressButton({ address }: { address: string }) {
  return (
    <button
      type="button"
      className="gm-copy-address"
      aria-label={`Copy ${address}`}
      title="Copy email address"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyEmailAddress(address);
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    </button>
  );
}

// One message in the Gmail-style thread: a clickable header row (avatar,
// sender, snippet or recipients, date) with the body underneath when open.
function GmMessage({
  m,
  open,
  accountColor,
  accountLabel,
  accountEmail,
  onToggle,
}: {
  m: Message;
  open: boolean;
  accountColor: string;
  accountLabel: string;
  accountEmail: string;
  onToggle: () => void;
}) {
  const outbound = m.direction === "outbound";
  const deliveryState =
    m.client_delivery_state ?? (m.id.startsWith("optimistic-") ? "sending" : null);
  const sender = outbound ? "You" : senderLabel(m.from_name, m.from_address);
  const copyAddress = outbound ? m.to_addresses.filter(Boolean).join(", ") : m.from_address;
  const meta = outbound
    ? `to ${m.to_addresses.join(", ") || "(no recipients)"}`
    : `${m.from_address} via ${accountLabel}`;
  return (
    <div className="gm-msg">
      <div
        className="gm-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          // The copy control is a real button inside this header. Only the
          // header itself should toggle the message open/closed.
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <SenderAvatar
          name={outbound ? sender : m.from_name}
          email={outbound ? accountEmail : m.from_address}
          color={outbound ? "#0C7DFF" : accountColor}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="gm-top">
            <span className="gm-name">{sender}</span>
            {open ? (
              <span className="gm-meta-wrap">
                {deliveryState ? <DeliveryStatus state={deliveryState} /> : null}
                <span className="gm-meta">{meta}</span>
                {copyAddress ? <CopyAddressButton address={copyAddress} /> : null}
              </span>
            ) : null}
            <span className="gm-when">{formatWhen(m.date)}</span>
          </div>
          {!open && (
            <div className="gm-snip">
              {deliveryState ? <DeliveryStatus state={deliveryState} /> : m.snippet || meta}
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="gm-body">
          <MessageBody messageId={m.id} bodyHtml={m.body_html} bodyText={m.body_text} />
          {m.attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {m.attachments.map((a) => (
                <AttachmentChip
                  key={a.partId}
                  messageId={m.id}
                  partId={a.partId}
                  filename={a.filename ?? "attachment"}
                  size={a.size}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AttachmentChip({
  messageId,
  partId,
  filename,
  size,
}: {
  messageId: string;
  partId: string;
  filename: string;
  size: number;
}) {
  const kb = Math.max(1, Math.round(size / 1024));
  return (
    <a
      className="chip"
      href={`${import.meta.env.VITE_API_URL ?? ""}/api/messages/${messageId}/attachments/${partId}`}
      onClick={async (e) => {
        // Attachments need the bearer token, so fetch as a blob (api() is
        // JSON-only) and hand the bytes to the browser.
        e.preventDefault();
        const { supabase } = await import("../lib/supabase.js");
        const { data } = await supabase.auth.getSession();
        const res = await fetch(
          `${import.meta.env.VITE_API_URL ?? ""}/api/messages/${messageId}/attachments/${partId}`,
          { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } },
        );
        if (!res.ok) return alert("Could not download the attachment.");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      📎 {filename} ({kb} KB)
    </a>
  );
}
