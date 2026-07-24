import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase.js";
import { LOGO_SRC, MAIL_SRC } from "../lib/assets.js";

// Auth screen in the uni-ui kit: blue radial backdrop, rings, floating
// envelopes, one centered white card. /app/signup and /app/login pick the mode.
export function Login() {
  const [mode, setMode] = useState<"signin" | "signup">(() =>
    window.location.pathname.endsWith("/signup") ? "signup" : "signin",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  function switchMode(m: "signin" | "signup") {
    setMode(m);
    setError(null);
    setNotice(null);
    window.history.replaceState(null, "", m === "signup" ? "/app/signup" : "/app/login");
  }

  async function oauth(provider: "google" | "azure") {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/app` },
    });
    if (error) {
      const label = provider === "google" ? "Google" : "Outlook";
      setError(`${label} sign in is not available right now. Use email and password below.`);
    }
  }

  async function forgotPassword() {
    setError(null);
    setNotice(null);
    if (!email) {
      setError("Type your email above first, then click the reset link again.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/app/reset`,
    });
    if (error) setError(error.message);
    else setNotice("Reset link sent. Check your email, then follow it to set a new password.");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (isSignup && password.length < 8) {
      setError("Password must be at least 8 characters.");
      setBusy(false);
      return;
    }

    if (!isSignup) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name || undefined },
          // Send the confirmation link back to THIS deployment's app, not the
          // Supabase project's default Site URL (shared with ibookshelf).
          emailRedirectTo: `${window.location.origin}/app`,
        },
      });
      if (error) {
        setError(error.message);
      } else if (!data.session) {
        setNotice("Almost there. Check your email for a confirmation link, then log in.");
        switchMode("signin");
      }
    }
    setBusy(false);
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

        <h1>{isSignup ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-sub">
          {isSignup
            ? "One dashboard for every project inbox."
            : "Log in to your unified inbox. Every account, one dashboard."}
        </p>
        {isSignup && <p className="auth-trial">Free for 3 days. No card needed.</p>}

        <div className="oauth">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void oauth("google");
            }}
          >
            <svg viewBox="0 0 24 18">
              <path d="M1.6 18h3.2V8.3L0 4.9v11.5C0 17.3.7 18 1.6 18Z" fill="#4285F4" />
              <path d="M19.2 18h3.2c.9 0 1.6-.7 1.6-1.6V4.9l-4.8 3.4V18Z" fill="#34A853" />
              <path d="M19.2 1.6v6.7L24 4.9V2.4c0-2-2.3-3.1-3.9-1.9l-.9.7v.4Z" fill="#FBBC04" />
              <path d="M4.8 8.3V1.6L12 7l7.2-5.4v6.7L12 13.7 4.8 8.3Z" fill="#EA4335" />
              <path d="M0 2.4v2.5l4.8 3.4V1.6l-.9-.7C2.3-.3 0 .9 0 2.4Z" fill="#C5221F" />
            </svg>
            Continue with Google
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              void oauth("azure");
            }}
          >
            <svg viewBox="0 0 24 24">
              <rect width="24" height="24" rx="6" fill="#0078D4" />
              <text x="12" y="16.5" fontFamily="Arial, sans-serif" fontSize="11" fontWeight="700" fill="#ffffff" textAnchor="middle">
                O
              </text>
            </svg>
            Continue with Outlook
          </a>
        </div>

        <div className="divider">or with email</div>

        <form onSubmit={onSubmit}>
          {isSignup && (
            <div className="field">
              <label>Name</label>
              <input
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@yourproject.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              required
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder={isSignup ? "At least 8 characters" : "••••••••"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {!isSignup && (
            <p style={{ marginTop: 8, textAlign: "right", fontSize: 12.5 }}>
              <a
                href="#"
                style={{ color: "var(--ink3)", fontWeight: 600 }}
                onClick={(e) => {
                  e.preventDefault();
                  void forgotPassword();
                }}
              >
                Forgot password?
              </a>
            </p>
          )}

          {error && <p className="err">{error}</p>}
          {notice && <p className="ok-note">{notice}</p>}

          <div className="auth-cta">
            <button type="submit" className="btn-black" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Working…" : isSignup ? "Create account" : "Log in"}
            </button>
          </div>
        </form>

        <p className="auth-swap">
          {isSignup ? "Already have an account?" : "New to OneInbox?"}{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              switchMode(isSignup ? "signin" : "signup");
            }}
          >
            {isSignup ? "Log in" : "Create an account"}
          </a>
        </p>
        <p className="auth-legal">Protected by AES-256 encryption. Only you ever see your messages.</p>
      </div>
    </div>
  );
}
