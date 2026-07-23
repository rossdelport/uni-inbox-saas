import { useState } from "react";
import { useReply, useThread, useThreadOp } from "../lib/queries.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { MessageBody } from "../components/MessageBody.js";
import { MAIL_SRC } from "../lib/assets.js";
import { toast } from "../lib/toast.js";

// The reading pane (.read-wrap): via chips, action chips, big subject,
// sender rows, message bodies and the reply composer.
export function ReadingPane({ threadId, onBack }: { threadId: string | null; onBack: () => void }) {
  const { data, isLoading, error } = useThread(threadId);
  const threadOp = useThreadOp();
  const reply = useReply();
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  function sendReply() {
    if (!draft.trim() || !threadId) return;
    reply.mutate(
      { threadId, body_text: draft },
      {
        onSuccess: () => {
          setDraft("");
          toast(`Reply sent from ${data?.thread.account_email}`);
        },
      },
    );
  }

  return (
    <div className="read-wrap">
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
        </span>
      </div>

      <h1>{thread.subject || "(no subject)"}</h1>

      {messages.map((m, i) => {
        const isLast = i === lastIdx;
        const open = isLast || expanded.has(m.id);
        const sender = m.direction === "outbound" ? "You" : senderLabel(m.from_name, m.from_address);
        return (
          <div key={m.id}>
            <div
              className="read-from"
              style={{ cursor: isLast ? "default" : "pointer" }}
              onClick={() => {
                if (isLast) return;
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(m.id)) next.delete(m.id);
                  else next.add(m.id);
                  return next;
                });
              }}
            >
              <div
                className="ava"
                style={{ background: m.direction === "outbound" ? "var(--b1)" : thread.account_color }}
              >
                {(sender || "?").charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="n">{sender}</div>
                <div className="e">
                  {m.direction === "outbound"
                    ? `to ${m.to_addresses.join(", ")}`
                    : `${m.from_address} via ${thread.account_label}`}
                </div>
              </div>
              <span className="when">{formatWhen(m.date)}</span>
            </div>
            {open && (
              <div className="read-body">
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
      })}

      <div className="read-reply">
        <textarea
          placeholder={`Reply to ${replyTo}...`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {reply.error && <p className="err">{(reply.error as Error).message}</p>}
        <div className="rr-bar">
          <span className="rr-note">
            Sends from {thread.account_email}
          </span>
          <button className="btn-sm" disabled={reply.isPending || !draft.trim()} onClick={sendReply}>
            {reply.isPending ? "Sending…" : "Reply"}
          </button>
        </div>
      </div>
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
