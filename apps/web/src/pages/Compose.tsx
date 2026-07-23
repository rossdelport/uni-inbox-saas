import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAccounts, useCompose } from "../lib/queries.js";
import { AccountBadge } from "../components/AccountBadge.js";

// Fresh compose: the ONE place where the from-account is an explicit choice.
export function Compose() {
  const { data: accounts } = useAccounts();
  const compose = useCompose();
  const navigate = useNavigate();
  const active = (accounts ?? []).filter((a) => a.status === "active");
  const [accountId, setAccountId] = useState<string>("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const fromId = accountId || active[0]?.id || "";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const recipients = to
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0 || !fromId) return;
    compose.mutate(
      { account_id: fromId, to: recipients, subject, body_text: body },
      { onSuccess: ({ thread_id }) => navigate(`/t/${thread_id}`) },
    );
  }

  if (active.length === 0) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        Connect an inbox first, then you can send from it.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display mb-5 text-2xl font-bold tracking-tight">New message</h1>
      <form onSubmit={onSubmit} className="card-lg space-y-4 p-6">
        <div>
          <label className="label">From</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {active.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  fromId === a.id
                    ? "border-zinc-900 bg-zinc-50"
                    : "border-zinc-200 hover:border-zinc-400"
                }`}
                onClick={() => setAccountId(a.id)}
              >
                <AccountBadge color={a.color} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{a.label}</span>
                  <span className="block truncate text-xs text-zinc-500">{a.email_address}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">To</label>
          <input
            className="input"
            required
            placeholder="name@example.com, other@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Subject</label>
          <input
            className="input"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Message</label>
          <textarea
            className="input min-h-48 resize-y"
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        {compose.error && (
          <p className="text-sm text-red-600">{(compose.error as Error).message}</p>
        )}
        <div className="flex justify-end">
          <button type="submit" className="btn" disabled={compose.isPending}>
            {compose.isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
