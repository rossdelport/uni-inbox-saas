import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase.js";

// Auth screen in the Maily language: sky-gradient hero panel with floating
// envelopes, a big rounded white card, pill tabs and the dark pill button.
// Served for /app/login and /app/signup: the path picks the starting tab.
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
        setNotice("Almost there. Check your email for a confirmation link, then sign in.");
        switchMode("signin");
      }
    }
    setBusy(false);
  }

  return (
    <div className="sky-panel relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-16">
      {/* Floating envelope accents */}
      <span className="envelope left-[8%] top-[14%] text-6xl" style={{ ["--tilt" as never]: "-10deg" }}>
        ✉️
      </span>
      <span
        className="envelope right-[10%] top-[22%] text-5xl opacity-80"
        style={{ ["--tilt" as never]: "8deg", animationDelay: "-3s" }}
      >
        ✉️
      </span>
      <span
        className="envelope bottom-[12%] left-[16%] text-4xl opacity-60"
        style={{ ["--tilt" as never]: "14deg", animationDelay: "-5s" }}
      >
        ✉️
      </span>

      <a href="/" className="font-display mb-8 text-2xl font-extrabold tracking-tight text-white">
        Uni-Inbox
      </a>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-7 text-center text-white">
          <div className="chip mx-auto mb-4 text-[13px]" style={{ color: "var(--ink-50)" }}>
            ✉️ Built for people who run more than one thing
          </div>
          <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
            {isSignup ? (
              <>
                Every inbox. <span style={{ color: "#003C8A" }}>One place.</span>
              </>
            ) : (
              <>Welcome back.</>
            )}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-white/85">
            {isSignup
              ? "Connect Gmail, Porkbun, or any mailbox, and always reply from the right address."
              : "Your projects kept their inboxes tidy while you were away."}
          </p>
        </div>

        <div className="card-lg p-7">
          <div
            className="mb-6 grid grid-cols-2 rounded-full p-1 text-sm"
            style={{ background: "#f5f5f5", boxShadow: "var(--shadow-glow)" }}
          >
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className="font-ui rounded-full py-2 font-semibold transition"
                style={
                  mode === m
                    ? { background: "#fff", boxShadow: "var(--shadow-card)", color: "var(--ink)" }
                    : { color: "var(--ink-45)" }
                }
                onClick={() => switchMode(m)}
              >
                {m === "signin" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            {isSignup && (
              <div>
                <label className="label">Name</label>
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                required
                autoComplete={isSignup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? "At least 8 characters" : undefined}
                className="input"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {notice && (
              <p
                className="rounded-2xl px-4 py-2.5 text-sm"
                style={{ background: "var(--blue-100)", color: "#0a4fa8" }}
              >
                {notice}
              </p>
            )}

            <button type="submit" className="btn w-full py-3" disabled={busy}>
              {busy ? "Working…" : isSignup ? "Create your account" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-[13px] leading-relaxed text-white/80">
          14 day free trial, no card needed. Your mail passwords are encrypted, always.
        </p>
      </div>
    </div>
  );
}
