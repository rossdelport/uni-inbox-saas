import { useState } from "react";
import { useDeleteThread, useThread, useThreadOp } from "../lib/queries.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { MessageBody } from "../components/MessageBody.js";
import { SenderAvatar } from "../components/SenderAvatar.js";
import { ReplyComposer } from "../components/ReplyComposer.js";
import { MAIL_SRC } from "../lib/assets.js";
import { toast } from "../lib/toast.js";
import type { Message } from "../lib/types.js";

// The reading pane (.read-wrap): via chips, action chips, big subject,
// sender rows, message bodies and the reply composer.
export function ReadingPane({ threadId, onBack }: { threadId: string | null; onBack: () => void }) {
  const { data, isLoading, error } = useThread(threadId);
  const threadOp = useThreadOp();
  const deleteThread = useDeleteThread();
  // Toggled message ids. The latest message defaults open, older ones closed;
  // a toggle flips whichever default applies (so the last one can collapse too).
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [showEarlier, setShowEarlier] = useState(false);

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
          <button style={{ color: "var(--b1)", fontWeight: 600 }} onClick={onBack}>
            Back to the list
          </button>
        </div>
      </div>
    );
  }

  const { thread, messages } = data;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
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
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            className={`chip ${thread.starred ? "on" : ""}`}
            onClick={() => threadOp.mutate({ threadId: thread.id, op: thread.starred ? "unstar" : "star" })}
          >
            ★ {thread.starred ? "Starred" : "Star"}
          </button>
          <button
            className={`chip ${thread.read_later ? "on" : ""}`}
            onClick={() => threadOp.mutate({ threadId: thread.id, op: thread.read_later ? "unlater" : "later" })}
          >
            ◷ {thread.read_later ? "Saved" : "Read later"}
          </button>
          <button
            className="chip"
            onClick={() => {
              threadOp.mutate({
                threadId: thread.id,
                op: thread.archived ? "unarchive" : "archive",
              });
              onBack();
            }}
          >
            {thread.archived ? "↩ Unarchive" : "🗂 Archive"}
          </button>
          <button
            className="chip"
            onClick={() => {
              if (!window.confirm("Delete this conversation from OneInbox? Your real mailbox is untouched.")) return;
              deleteThread.mutate(thread.id, { onSuccess: () => toast("Conversation deleted", "danger") });
              onBack();
            }}
          >
            🗑 Delete
          </button>
        </span>
      </div>

      <h1>{thread.subject || "(no subject)"}</h1>

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
          const open = isLast !== toggled.has(m.id);
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
      </div>

      <ReplyComposer threadId={thread.id} replyTo={replyTo} accountEmail={thread.account_email} />
    </div>
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
  const sender = outbound ? "You" : senderLabel(m.from_name, m.from_address);
  const meta = outbound
    ? `to ${m.to_addresses.join(", ")}`
    : `${m.from_address} via ${accountLabel}`;
  return (
    <div className="gm-msg">
      <button className="gm-head" onClick={onToggle}>
        <SenderAvatar
          name={outbound ? sender : m.from_name}
          email={outbound ? accountEmail : m.from_address}
          color={outbound ? "#308dfc" : accountColor}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="gm-top">
            <span className="gm-name">{sender}</span>
            {open && <span className="gm-meta">{meta}</span>}
            <span className="gm-when">{formatWhen(m.date)}</span>
          </div>
          {!open && <div className="gm-snip">{m.snippet || meta}</div>}
        </div>
      </button>
      {open && (
        <div className="gm-body">
          <MessageBody bodyHtml={m.body_html} bodyText={m.body_text} />
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
