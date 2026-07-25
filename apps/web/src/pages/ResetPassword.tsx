import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { toast } from "../lib/toast.js";
import { PasswordInput } from "../components/PasswordInput.js";
import { LOGO_SRC, MAIL_SRC } from "../lib/assets.js";

// Landing page for the password-recovery email link. Supabase signs the user
// in with a recovery session, so this only has to set the new password.
//
// It deliberately uses the auth-page shell rather than the dashboard one: the
// route is reached straight from an email, before the user has chosen to be
// in the app, and showing the sidebar, mail counts and trial card around a
// password form made it look like a settings screen they had navigated to.
export function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) return setErr("Password must be at least 8 characters.");
    if (password !== password2) return setErr("Those passwords do not match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setErr(error.message);
    navigate("/", { replace: true });
    // The toast host lives in the dashboard layout, which this page is
    // deliberately outside of. Fire the message once that navigation has
    // mounted it, otherwise the event has no listener and is dropped.
    setTimeout(() => toast("Password updated. You're signed in.", "success"), 80);
  }

  return (
    <div className="auth-body">
      <span className="auth-ring" style={{ width: "46rem", height: "46rem" }} />
      <span className="auth-ring" style={{ width: "72rem", height: "72rem" }} />
      <span className="auth-ring" style={{ width: "100rem", height: "100rem" }} />

      <img className="auth-mail" src={MAIL_SRC} alt="" style={{ width: 170, left: "8%", top: "13%", transform: "rotate(-16deg)" }} />
      <img className="auth-mail" src={MAIL_SRC} alt="" style={{ width: 120, left: "13%", bottom: "9%", transform: "rotate(9deg)" }} />
      <img className="auth-mail" src={MAIL_SRC} alt="" style={{ width: 200, right: "6%", top: "56%", transform: "rotate(13deg)" }} />

      <a className="auth-back" href="/">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to home
      </a>

      <div className="auth-card">
        <a className="logo-link" href="/">
          <span className="logo-lock">
            <img src={LOGO_SRC} alt="OneInbox logo" />
            <span>oneinbox</span>
          </span>
        </a>

        <h1>Set a new password</h1>
        <p className="auth-sub">Pick something you'll remember. We'll take you straight to your inbox.</p>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label>New password</label>
            <PasswordInput
              autoFocus
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <PasswordInput
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </div>
          {err && <p className="err">{err}</p>}
          <div className="auth-cta">
            <button type="submit" className="btn-black" disabled={busy || !password}>
              {busy ? "Saving…" : "Save and continue"}
            </button>
          </div>
        </form>

        <p className="auth-legal">
          This link signed you in. Setting a password finishes the reset.
        </p>
      </div>
    </div>
  );
}
