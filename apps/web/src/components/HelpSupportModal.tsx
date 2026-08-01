import { useState, type FormEvent } from "react";
import { ModalShell } from "./PlansModal.js";

export function HelpSupportModal({
  name: initialName,
  email: initialEmail,
  onClose,
}: {
  name: string;
  email: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "We could not send your message. Please try again.");
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not send your message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <ModalShell
      title="Help & support"
      sub={sent ? undefined : "Tell us what you need. We’ll reply to you by email."}
      onClose={onClose}
    >
      {sent ? (
        <div className="help-sent">
          <span aria-hidden="true">✓</span>
          <h4>Message sent</h4>
          <p>Thanks for letting us know. We’ll reply to {email}.</p>
          <button className="btn-black" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form className="help-form" onSubmit={submit}>
          <div className="help-fields">
            <div className="field">
              <label htmlFor="help-name">Name</label>
              <input
                id="help-name"
                value={name}
                maxLength={200}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="help-email">Email</label>
              <input
                id="help-email"
                type="email"
                value={email}
                maxLength={320}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="help-message">How can we help?</label>
            <textarea
              id="help-message"
              value={message}
              maxLength={5000}
              rows={6}
              required
              autoFocus
              placeholder="Tell us what happened or what you need help with…"
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="help-actions">
            <button className="btn-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn-black" type="submit" disabled={sending || !message.trim()}>
              {sending && <span className="spin" />}
              {sending ? "Sending…" : "Send message"}
            </button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}
