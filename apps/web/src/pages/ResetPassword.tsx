import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { toast } from "../lib/toast.js";

// Landing page for the password-recovery email link. Supabase signs the user
// in with a recovery session; this just sets the new password.
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
    if (password !== password2) return setErr("Passwords do not match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setErr(error.message);
    toast("Password updated. You're signed in.", "success");
    navigate("/");
  }

  return (
    <div className="set-content" style={{ flex: 1 }}>
      <div className="set-pane active">
        <h1>Set a new password</h1>
        <p className="p-sub">You followed a reset link, so you're signed in. Pick a new password.</p>
        <form className="set-card" onSubmit={onSubmit} style={{ maxWidth: 440 }}>
          <div className="field">
            <label>New password</label>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
            />
          </div>
          {err && <p className="err">{err}</p>}
          <div style={{ marginTop: 18 }}>
            <button
              type="submit"
              className="btn-black"
              style={{ width: "auto", padding: "0 28px", height: 44, fontSize: 14 }}
              disabled={busy || !password}
            >
              {busy ? "Saving…" : "Save new password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
