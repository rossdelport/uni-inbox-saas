import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase.js";

// Auth screens styled as a continuation of the marketing site: floating pill
// nav, a 48px-radius sky-gradient hero panel with floating envelopes, the
// form in a big rounded white card inside the panel, chips and a footer.
// Served for /app/login and /app/signup: the path picks the starting mode.
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
        setNotice("Almost there. Check your email for a confirmation link, then log in.");
        switchMode("signin");
      }
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--off-white)" }}>
      {/* Floating pill nav, same as the landing page */}
      <nav
        className="fixed left-1/2 top-6 z-50 flex w-[min(700px,calc(100vw-32px))] -translate-x-1/2 items-center gap-1 rounded-full border bg-white py-2 pl-3 pr-2"
        style={{
          borderColor: "var(--ink-10)",
          boxShadow: "var(--shadow-card), var(--shadow-glow)",
        }}
      >
        <a href="/" className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-[10px] text-sm"
            style={{ background: "linear-gradient(160deg, #0c7dff 0%, #003c8a 100%)" }}
          >
            ✉️
          </span>
          <span className="font-display text-[17px] font-extrabold tracking-tight" style={{ color: "var(--ink)" }}>
            Uni-Inbox
          </span>
        </a>
        <div className="font-ui ml-4 hidden items-center gap-5 text-[15px] font-medium sm:flex" style={{ color: "#444343" }}>
          <a className="transition hover:text-black" href="/">
            Home
          </a>
          <a className="transition hover:text-black" href="/pricing">
            Pricing
          </a>
          <a className="transition hover:text-black" href="/contacts">
            Contacts
          </a>
        </div>
        <button
          type="button"
          className="btn ml-auto px-5 py-2 text-[14px]"
          onClick={() => switchMode(isSignup ? "signin" : "signup")}
        >
          {isSignup ? "Log in" : "Start Today"}
        </button>
      </nav>

      <main className="mx-auto max-w-6xl px-4 pb-10 pt-28">
        {/* Sky hero panel, the same big rounded gradient block as the landing hero */}
        <section className="sky-panel relative overflow-hidden rounded-[48px] px-5 py-12 sm:px-10 sm:py-16">
          <span className="envelope left-[5%] top-[9%] text-6xl" style={{ ["--tilt" as never]: "-11deg" }}>
            ✉️
          </span>
          <span
            className="envelope right-[7%] top-[16%] text-5xl opacity-85"
            style={{ ["--tilt" as never]: "9deg", animationDelay: "-3s" }}
          >
            ✉️
          </span>
          <span
            className="envelope bottom-[10%] left-[12%] hidden text-4xl opacity-70 sm:block"
            style={{ ["--tilt" as never]: "15deg", animationDelay: "-5s" }}
          >
            ✉️
          </span>
          <span
            className="envelope bottom-[20%] right-[13%] hidden text-3xl opacity-60 sm:block"
            style={{ ["--tilt" as never]: "-7deg", animationDelay: "-6.5s" }}
          >
            ✉️
          </span>

          <div className="relative z-10 mx-auto max-w-xl text-center text-white">
            <div className="chip mb-5 text-[13px]" style={{ color: "var(--ink-50)" }}>
              ✉️ One inbox for every project you run
            </div>
            <h1 className="font-display text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
              {isSignup ? (
                <>
                  Every inbox. <span style={{ color: "#003c8a" }}>One place.</span>
                </>
              ) : (
                <>
                  Welcome <span style={{ color: "#003c8a" }}>back.</span>
                </>
              )}
            </h1>
            <p className="mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-white/90">
              {isSignup ? (
                <>
                  Connect Gmail, Porkbun, or any mailbox, and always{" "}
                  <span className="font-semibold text-white">reply from the right address</span>.
                </>
              ) : (
                <>Your projects kept their inboxes tidy while you were away.</>
              )}
            </p>

            {/* The form card, floating inside the hero like the landing mock cards */}
            <div
              className="card-lg mx-auto mt-8 max-w-md p-7 text-left sm:p-8"
              style={{ boxShadow: "var(--shadow-float)" }}
            >
              <h2 className="font-display text-xl font-bold tracking-tight" style={{ color: "var(--ink)" }}>
                {isSignup ? "Create your free account" : "Log in to your inbox"}
              </h2>
              <p className="mt-1 text-[13.5px]" style={{ color: "var(--ink-50)" }}>
                {isSignup
                  ? "14 day free trial. No card needed."
                  : "Good to see you again."}
              </p>

              <form onSubmit={onSubmit} className="mt-5 space-y-4">
                {isSignup && (
                  <div>
                    <label className="label">Name</label>
                    <input
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="input rounded-full px-5"
                      placeholder="What should we call you?"
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
                    className="input rounded-full px-5"
                    placeholder="you@yourproject.com"
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
                    placeholder={isSignup ? "At least 8 characters" : "Your password"}
                    className="input rounded-full px-5"
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

                <button type="submit" className="btn w-full py-3 text-[15px]" disabled={busy}>
                  {busy ? "Working…" : isSignup ? "Get Started" : "Log in"}
                </button>
              </form>

              <p className="mt-5 text-center text-[13px]" style={{ color: "var(--ink-50)" }}>
                {isSignup ? "Already have an account?" : "New here?"}{" "}
                <button
                  type="button"
                  className="font-semibold underline-offset-2 hover:underline"
                  style={{ color: "var(--blue-primary)" }}
                  onClick={() => switchMode(isSignup ? "signin" : "signup")}
                >
                  {isSignup ? "Log in" : "Create your free account"}
                </button>
              </p>
            </div>

            <p className="mt-6 text-[13px] leading-relaxed text-white/80">
              Your mail passwords are stored encrypted, always.
            </p>
          </div>
        </section>

        {/* Feature chips, echoing the landing feature grid */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2.5">
          {[
            "🎨 Color coded per project",
            "↩️ Reply from the right address",
            "🔐 Encrypted passwords",
            "📮 Gmail, Porkbun and any IMAP",
            "🗓 14 day free trial",
          ].map((f) => (
            <span key={f} className="chip text-[12.5px]" style={{ color: "var(--ink-50)" }}>
              {f}
            </span>
          ))}
        </div>

        {/* Footer strip in the landing footer's voice */}
        <footer
          className="mt-12 flex flex-col items-center gap-2 border-t pt-6 text-[12.5px] sm:flex-row sm:justify-between"
          style={{ borderColor: "var(--ink-10)", color: "var(--ink-45)" }}
        >
          <span className="font-ui font-medium">Uni-Inbox · every project, one inbox</span>
          <div className="flex items-center gap-4">
            <a className="hover:text-black" href="/">
              Home
            </a>
            <a className="hover:text-black" href="/pricing">
              Pricing
            </a>
            <a className="hover:text-black" href="/privacy-policy">
              Privacy Policy
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
