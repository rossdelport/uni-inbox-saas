import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useReply, useThread, useThreadOp } from "../lib/queries.js";
import { formatWhen, senderLabel } from "../lib/format.js";
import { MessageBody } from "../components/MessageBody.js";

// The right-hand reading pane: account chips, big subject, sender row,
// message bodies, and a reply composer card with the black Reply pill.
export function ReadingPane({ threadId }: { threadId: string | null }) {
  const { data, isLoading, error } = useThread(threadId);
  const threadOp = useThreadOp();
  const reply = useReply();
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (!threadId) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-zinc-100 text-2xl">
            📭
          </span>
          <p className="mt-4 text-[15px] font-medium text-zinc-500">
            Select a message to read it here
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) return <div className="p-10 text-sm text-zinc-400">Loading…</div>;
  if (error || !data) {
    return (
      <div className="p-10 text-sm text-zinc-500">
        Thread not found.{" "}
        <button className="underline" onClick={() => navigate("/")}>
          Back to inbox
        </button>
      </div>
    );
  }

  const { thread, messages } = data;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  const replyTo = last?.direction === "outbound" ? "them" : senderLabel(last?.from_name ?? null, last?.from_address ?? null);

  function sendReply() {
    if (!draft.trim() || !threadId) return;
    reply.mutate({ threadId, body_text: draft }, { onSuccess: () => setDraft("") });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
        {/* Back (mobile) + chips + actions */}
        <div className="mb-4 flex items-center gap-2">
          <button
            className="mr-1 grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 md:hidden"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            ←
          </button>
          <span className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12.5px] font-medium text-zinc-600">
            <span className="h-2 w-2 rounded-full" style={{ background: thread.account_color }} />
            via {thread.account_label}
          </span>
          <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12.5px] font-medium text-zinc-600">
            to {thread.account_email}
          </span>
          <button
            className="ml-auto rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-zinc-600 transition hover:bg-zinc-50"
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

        <h1 className="text-[30px] font-bold leading-tight tracking-tight text-zinc-900">
          {thread.subject || "(no subject)"}
        </h1>

        <div className="mt-6 space-y-6">
          {messages.map((m, i) => {
            const isLast = i === lastIdx;
            const open = isLast || expanded.has(m.id);
            const sender = m.direction === "outbound" ? "You" : senderLabel(m.from_name, m.from_address);
            return (
              <div key={m.id}>
                <button
                  className="flex w-full items-center gap-3 text-left"
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
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[16px] font-semibold text-white"
                    style={{ background: m.direction === "outbound" ? "#1c7ef7" : thread.account_color }}
                  >
                    {(sender || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-zinc-900">{sender}</span>
                    <span className="block truncate text-[13px] text-zinc-400">
                      {m.direction === "outbound"
                        ? `to ${m.to_addresses.join(", ")}`
                        : `${m.from_address} via ${thread.account_label}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] text-zinc-400">{formatWhen(m.date)}</span>
                </button>

                {open && (
                  <div className="mt-4 border-t border-zinc-100 pt-5">
                    <MessageBody bodyHtml={m.body_html} bodyText={m.body_text} />
                    {m.attachments.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
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

        {/* Reply composer */}
        <div className="mt-10 rounded-2xl border border-zinc-200 bg-white">
          <textarea
            className="min-h-28 w-full resize-y rounded-t-2xl px-5 pt-4 text-[14.5px] text-zinc-800 outline-none placeholder:text-zinc-400"
            placeholder={`Reply to ${replyTo}...`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {reply.error && (
            <p className="px-5 pb-1 text-sm text-red-600">{(reply.error as Error).message}</p>
          )}
          <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-1">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-zinc-400">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: thread.account_color }} />
              Sends from {thread.account_email}
            </span>
            <button
              className="btn-dark shrink-0 px-6"
              disabled={reply.isPending || !draft.trim()}
              onClick={sendReply}
            >
              {reply.isPending ? "Sending…" : "Reply"}
            </button>
          </div>
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
