import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useReply, useThread, useThreadOp } from "../lib/queries.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { AccountBadge } from "../components/AccountBadge.js";
import { MessageBody } from "../components/MessageBody.js";

export function ThreadView() {
  const { threadId } = useParams();
  const { data, isLoading, error } = useThread(threadId ?? null);
  const threadOp = useThreadOp();
  const reply = useReply();
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (isLoading) return <div className="p-8 text-sm text-zinc-400">Loading thread…</div>;
  if (error || !data) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        Thread not found. <Link className="underline" to="/">Back to inbox</Link>
      </div>
    );
  }

  const { thread, messages } = data;
  const lastIdx = messages.length - 1;

  function sendReply() {
    if (!draft.trim() || !threadId) return;
    reply.mutate(
      { threadId, body_text: draft },
      { onSuccess: () => setDraft("") },
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <button className="btn-ghost px-3 py-1.5" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{thread.subject || "(no subject)"}</h1>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
            <AccountBadge color={thread.account_color} size={7} />
            {thread.account_label} · {thread.account_email}
          </div>
        </div>
        <button
          className="btn-ghost px-3 py-1.5"
          onClick={() => {
            threadOp.mutate({
              threadId: thread.id,
              op: thread.archived ? "unarchive" : "archive",
            });
            navigate("/");
          }}
        >
          {thread.archived ? "Unarchive" : "Archive"}
        </button>
      </div>

      <div className="space-y-3">
        {messages.map((m, i) => {
          const isLast = i === lastIdx;
          const open = isLast || expanded.has(m.id);
          return (
            <div key={m.id} className="card">
              <button
                className="flex w-full items-baseline gap-2 px-4 py-3 text-left"
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
                <span className="text-sm font-medium">
                  {m.direction === "outbound" ? "You" : senderLabel(m.from_name, m.from_address)}
                </span>
                <span className="hidden truncate text-xs text-zinc-400 sm:inline">
                  to {m.to_addresses.join(", ")}
                </span>
                <span className="ml-auto shrink-0 text-xs text-zinc-400">{formatWhen(m.date)}</span>
              </button>
              {open && (
                <div className="border-t border-zinc-100 px-4 py-3">
                  <MessageBody bodyHtml={m.body_html} bodyText={m.body_text} />
                  {m.attachments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
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
      </div>

      <div className="card mt-4 p-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-500">
          Replying as
          <AccountBadge color={thread.account_color} size={7} />
          <span className="font-medium text-zinc-700">{thread.account_email}</span>
        </div>
        <textarea
          className="input min-h-28 resize-y"
          placeholder="Write your reply…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {reply.error && (
          <p className="mt-2 text-sm text-red-600">{(reply.error as Error).message}</p>
        )}
        <div className="mt-3 flex justify-end">
          <button className="btn" disabled={reply.isPending || !draft.trim()} onClick={sendReply}>
            {reply.isPending ? "Sending…" : "Send reply"}
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
      className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
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
      {filename} <span className="text-zinc-400">({kb} KB)</span>
    </a>
  );
}
