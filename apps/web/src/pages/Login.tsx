import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase.js";

// Auth screen: full-bleed blue backdrop with concentric rings and floating
// 3D envelopes, one centered white card. Served for /app/login and
// /app/signup: the path picks the starting mode.
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
    <div className="auth-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Concentric rings radiating from the card */}
      <span className="auth-ring h-[46rem] w-[46rem]" />
      <span className="auth-ring h-[72rem] w-[72rem]" />
      <span className="auth-ring h-[100rem] w-[100rem]" />

      {/* Floating 3D envelopes */}
      <Envelope className="left-[7%] top-[12%] w-40" tilt="-18deg" />
      <Envelope className="bottom-[8%] left-[13%] w-28" tilt="8deg" delay="-3.5s" />
      <Envelope className="right-[6%] top-[58%] w-48" tilt="12deg" delay="-5s" />

      <div className="relative z-10 w-full max-w-[440px] rounded-[28px] bg-white px-7 py-9 shadow-[0_24px_60px_rgba(9,58,125,0.28)] sm:px-10">
        {/* Logo */}
        <a href="/" className="flex items-center justify-center gap-2">
          <img src={LOGO_SRC} alt="" className="h-9 w-9 rounded-[10px]" draggable={false} />
          <span className="text-[19px] font-bold tracking-tight text-zinc-900">uni-inbox</span>
        </a>

        <h1 className="mt-6 text-center text-[32px] font-bold tracking-tight text-zinc-900">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mx-auto mt-2 max-w-[300px] text-center text-[15px] leading-relaxed text-zinc-500">
          {isSignup
            ? "One dashboard for every project inbox. Free for 14 days, no card needed."
            : "Log in to your unified inbox. Every account, one dashboard."}
        </p>

        {/* OAuth */}
        <div className="mt-7 space-y-3">
          <button type="button" className="btn-oauth" onClick={() => void oauth("google")}>
            <svg width="20" height="15" viewBox="0 0 24 18">
              <path d="M1.6 18h3.2V8.3L0 4.9v11.5C0 17.3.7 18 1.6 18Z" fill="#4285F4" />
              <path d="M19.2 18h3.2c.9 0 1.6-.7 1.6-1.6V4.9l-4.8 3.4V18Z" fill="#34A853" />
              <path d="M19.2 1.6v6.7L24 4.9V2.4c0-2-2.3-3.1-3.9-1.9l-.9.7v.4Z" fill="#FBBC04" />
              <path d="M4.8 8.3V1.6L12 7l7.2-5.4v6.7L12 13.7 4.8 8.3Z" fill="#EA4335" />
              <path d="M0 2.4v2.5l4.8 3.4V1.6l-.9-.7C2.3-.3 0 .9 0 2.4Z" fill="#C5221F" />
            </svg>
            Continue with Google
          </button>
          <button type="button" className="btn-oauth" onClick={() => void oauth("azure")}>
            <span
              className="grid h-5 w-5 place-items-center rounded-[6px] text-[13px] font-bold text-white"
              style={{ background: "#0f6cbd" }}
            >
              o
            </span>
            Continue with Outlook
          </button>
        </div>

        {/* Divider */}
        <div className="mt-6 flex items-center gap-3 text-[13px] text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" />
          or with email
          <span className="h-px flex-1 bg-zinc-200" />
        </div>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          {isSignup && (
            <div>
              <label className="mb-1.5 block text-[14px] font-semibold text-zinc-800">Name</label>
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-auth"
                placeholder="Your name"
              />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-[14px] font-semibold text-zinc-800">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-auth"
              placeholder="you@yourproject.com"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[14px] font-semibold text-zinc-800">Password</label>
            <input
              type="password"
              required
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? "At least 8 characters" : "••••••••"}
              className="input-auth"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && (
            <p className="rounded-xl bg-[#e8f0ff] px-4 py-2.5 text-sm text-[#0a4fa8]">{notice}</p>
          )}

          <button
            type="submit"
            className="w-full rounded-full py-3.5 text-[16px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: "#0f0f0f" }}
            disabled={busy}
          >
            {busy ? "Working…" : isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="mt-5 text-center text-[14px] text-zinc-500">
          {isSignup ? "Already have an account?" : "New to Uni-Inbox?"}{" "}
          <button
            type="button"
            className="font-medium text-[#1c7ef7] hover:underline"
            onClick={() => switchMode(isSignup ? "signin" : "signup")}
          >
            {isSignup ? "Log in" : "Create an account"}
          </button>
        </p>

        <p className="mx-auto mt-4 max-w-[280px] text-center text-[12.5px] leading-relaxed text-zinc-400">
          Protected by AES-256 encryption. Only you ever see your messages.
        </p>
      </div>
    </div>
  );
}

// The same assets the landing page uses: its 3D envelope and its favicon mark.
const ENVELOPE_SRC = "https://framerusercontent.com/images/OEgOgKnJfYyJzdDPysfJV8oaYI.png";
const LOGO_SRC = "https://framerusercontent.com/images/0vnhI1yuWUzr4ARVv8yIuY9jQgA.png";

function Envelope({ className, tilt, delay }: { className: string; tilt: string; delay?: string }) {
  return (
    <img
      src={ENVELOPE_SRC}
      alt=""
      draggable={false}
      className={`envelope-img ${className}`}
      style={{ ["--tilt" as never]: tilt, animationDelay: delay }}
    />
  );
}
