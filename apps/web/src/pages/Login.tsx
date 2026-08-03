import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase.js";
import { LOGO_SRC, MAIL_SRC } from "../lib/assets.js";
import { PasswordInput } from "../components/PasswordInput.js";
import {
  clearPlanIntent,
  planIntentFromUrl,
  rememberPlanIntent,
  type PlanIntent,
} from "../lib/checkout.js";

const SRC_KEY = "oi-signup-src";

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
  // Which plan the marketing button was for. Read once on mount, because
  // switchMode rewrites the URL and would drop it on a re-read.
  const [intent] = useState<PlanIntent | null>(() => planIntentFromUrl());

  // Attribution: landing-page buttons arrive with ?src=<page:button>. Keep it
  // through the confirm-email round trip so signup can record it.
  //
  // The tag only exists when someone clicked a tagged CTA. Anyone who typed the
  // URL, followed an ad link, or came from a post arrived with nothing, and the
  // first three real signups all recorded no source at all. Fall back to the
  // campaign parameters and then the referring host, so a signup is only
  // unattributed when it genuinely has no origin to record.
  useEffect(() => {
    if (localStorage.getItem(SRC_KEY)) return; // first touch wins
    const q = new URLSearchParams(window.location.search);
    const tag =
      q.get("src") ??
      q.get("utm_source") ??
      (() => {
        try {
          const host = document.referrer ? new URL(document.referrer).hostname : "";
          return host && !host.endsWith("tryoneinbox.co") ? `ref:${host}` : null;
        } catch {
          return null;
        }
      })();
    if (tag) localStorage.setItem(SRC_KEY, tag.slice(0, 80));
  }, []);

  // Remember the plan across the confirm-email round trip, so someone who has
  // to click a link in their inbox still lands on the checkout they picked.
  useEffect(() => {
    if (isSignup && intent) rememberPlanIntent(intent);
  }, [isSignup, intent]);

  function switchMode(m: "signin" | "signup") {
    setMode(m);
    setError(null);
    setNotice(null);
    window.history.replaceState(null, "", m === "signup" ? "/app/signup" : "/app/login");
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
      // Store the plan BEFORE creating the account. App owns the Stripe
      // redirect: the moment a session exists it sees this intent, holds the
      // dashboard back behind a "taking you to checkout" screen, and
      // navigates. One path for both the instant case and the
      // confirm-email-first case, and no dashboard flash in between.
      rememberPlanIntent(intent ?? { tier: "monthly" });
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name || undefined,
            signup_source: localStorage.getItem(SRC_KEY) ?? undefined,
          },
          // Send the confirmation link back to THIS deployment's app, not the
          // Supabase project's default Site URL (shared with ibookshelf).
          emailRedirectTo: `${window.location.origin}/app`,
        },
      });
      if (error) {
        // No account was made, so nothing must lie in wait to redirect a
        // future sign-in to checkout.
        clearPlanIntent();
        setError(error.message);
      } else if (!data.session) {
        setNotice("Almost there. Check your email for a confirmation link, then log in.");
        switchMode("signin");
      }
      // With a session, App takes over: it sees the stored plan and goes
      // straight to Stripe without ever painting the dashboard.
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
        {isSignup && (
          <p className="auth-trial">
            {intent?.tier === "lifetime"
              ? "Create your account, then pay once for Lifetime."
              : intent?.tier === "yearly"
                ? "Free for 3 days, then $97/year. Cancel any time."
                : "Free for 3 days, then $10/month. Cancel any time."}
          </p>
        )}


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
            <PasswordInput
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

          {/* The moment someone hands over a mailbox password is the moment they
              want to know what happens to it, so the answer sits right under the
              button. Claims here mirror SecurityBadge and lib/crypto.ts. */}
          <div className="auth-secure">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-3z" />
              <path d="M9 12.2l2.1 2.1L15.2 10" />
            </svg>
            <p>
              <b>Your mailbox password is encrypted with AES-256-GCM</b> before it is
              stored, so we never hold it in readable form. Choose Google or Microsoft
              and we never receive a password at all.
            </p>
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
        {/* "Only you ever see your messages" used to sit here. It was not true:
            mail bodies are stored so the unified inbox can show and search them.
            Isolation and non-sale are the real, checkable promises. */}
        <p className="auth-legal">
          Your mail is isolated to your account, never sold, and never used to train AI.
        </p>
      </div>
    </div>
  );
}
