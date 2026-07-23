import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase.js";
import { useAccounts, useBillingState, usePortal } from "../lib/queries.js";
import { PlansModal } from "../components/PlansModal.js";

// Settings, in the Maily design language (docs/context/maily-design-spec.md):
// chunky rounded display headings, 24-40px cards, pill buttons, blue accents.
export function Settings() {
  const { data: billing } = useBillingState();
  const { data: accounts } = useAccounts();
  const portal = usePortal();
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setName((data.user?.user_metadata?.full_name as string | undefined) ?? "");
    });
  }, []);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSavedName(false);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
    if (!error) setSavedName(true);
    setBusy(false);
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwNotice(null);
    if (password.length < 8) {
      setPwError("Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setPwError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setPwError(error.message);
    else {
      setPwNotice("Password updated.");
      setPassword("");
      setPassword2("");
    }
    setBusy(false);
  }

  const activeAccounts = (accounts ?? []).filter((a) => a.status === "active").length;

  return (
    <div className="fade-panel h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="chip mb-3 text-[12px]" style={{ color: "var(--ink-45)" }}>
          ⚙️ Settings
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Your <span style={{ color: "var(--blue-primary)" }}>settings</span>.
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-50)" }}>
          Your profile, password, plan and connected inboxes, all in one place.
        </p>

        {/* Profile */}
        <form onSubmit={saveProfile} className="card mt-7 p-6">
          <h2 className="font-display text-lg font-bold tracking-tight">Profile</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSavedName(false);
                }}
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input opacity-60" value={user?.email ?? ""} disabled />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button type="submit" className="btn" disabled={busy}>
              Save profile
            </button>
            {savedName && (
              <span className="text-sm" style={{ color: "var(--blue-primary)" }}>
                ✓ Saved
              </span>
            )}
          </div>
        </form>

        {/* Password */}
        <form onSubmit={savePassword} className="card mt-5 p-6">
          <h2 className="font-display text-lg font-bold tracking-tight">Password</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">New password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
              />
            </div>
          </div>
          {pwError && <p className="mt-3 text-sm text-red-600">{pwError}</p>}
          {pwNotice && (
            <p className="mt-3 text-sm" style={{ color: "var(--blue-primary)" }}>
              ✓ {pwNotice}
            </p>
          )}
          <button type="submit" className="btn mt-4" disabled={busy || !password}>
            Update password
          </button>
        </form>

        {/* Plan */}
        <div className="card mt-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight">Plan</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--ink-50)" }}>
                {billing ? (
                  <>
                    You're on{" "}
                    <span className="font-semibold" style={{ color: "var(--ink-83)" }}>
                      {billing.plan_label}
                    </span>
                    , {billing.connected_inboxes} of {billing.max_inboxes} inboxes used.
                  </>
                ) : (
                  "Loading…"
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => setPlansOpen(true)}>
                See plans
              </button>
              {billing && billing.plan !== "trial" && (
                <button
                  className="btn-ghost"
                  disabled={portal.isPending}
                  onClick={() => portal.mutate()}
                >
                  {portal.isPending ? "Opening…" : "Manage billing"}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Connected inboxes */}
        <div className="card mt-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight">Connected inboxes</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--ink-50)" }}>
                {activeAccounts} active inbox{activeAccounts === 1 ? "" : "es"} syncing right now.
              </p>
            </div>
            <Link to="/accounts" className="btn-ghost">
              Manage inboxes
            </Link>
          </div>
        </div>

        <button
          className="mt-7 text-sm font-medium text-red-600 underline-offset-2 hover:underline"
          onClick={() => void supabase.auth.signOut()}
        >
          Log out of Uni-Inbox
        </button>
      </div>

      {plansOpen && <PlansModal onClose={() => setPlansOpen(false)} />}
    </div>
  );
}
