import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAccounts, useCompose } from "../lib/queries.js";
import { toast } from "../lib/toast.js";
import { KP, useHotkeys } from "../lib/keyboard.js";
import { ContactAutocompleteInput } from "../components/ContactAutocompleteInput.js";

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
  // First Escape blurs whichever field you are in (global rule); the next
  // one returns to the inbox, but never over typed content: leaving this
  // page destroys the message state, so a started message refuses Escape.
  useHotkeys(
    {
      Escape: () => {
        if (to.trim() || subject.trim() || body.trim()) {
          toast("This message has not been sent. Send it or clear it first.", "warn");
          return;
        }
        void navigate("/");
      },
    },
    { priority: KP.list },
  );

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
      {
        onSuccess: () => {
          // Queued through the outbox: the thread does not exist until the
          // worker delivers, so land on Sent, where the scheduled strip and
          // then the real thread both show up.
          toast("On its way. It appears in Sent once delivered.", "success");
          navigate("/sent");
        },
      },
    );
  }

  if (active.length === 0) {
    return (
      <div className="set-content" style={{ flex: 1 }}>
        <div className="set-pane active">
          <h1>New message</h1>
          <p className="p-sub">Connect an inbox first, then you can send from it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="set-content" style={{ flex: 1 }}>
      <div className="set-pane active">
        <h1>New message</h1>
        <p className="p-sub">Pick which address it sends from.</p>

        <form
          className="set-card"
          onSubmit={onSubmit}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter sends from any field, with native validation.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.requestSubmit();
            }
          }}
        >
          <div className="field">
            <label>From</label>
            <div className="m-provs" style={{ marginTop: 4 }}>
              {active.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`m-prov ${fromId === a.id ? "sel" : ""}`}
                  onClick={() => setAccountId(a.id)}
                >
                  <i style={{ background: a.color }} />
                  <span style={{ minWidth: 0, textAlign: "left" }}>
                    {a.label}
                    <span style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--ink3)" }}>
                      {a.email_address}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>To</label>
            <ContactAutocompleteInput
              required
              placeholder="name@example.com, other@example.com"
              value={to}
              onChange={setTo}
            />
          </div>
          <div className="field">
            <label>Subject</label>
            <input required value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="field">
            <label>Message</label>
            <textarea
              required
              style={{ minHeight: 180, resize: "vertical" }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {compose.error && <p className="err">{(compose.error as Error).message}</p>}
          <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              className="btn-black btn-auto"
              disabled={compose.isPending}
            >
              {compose.isPending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
