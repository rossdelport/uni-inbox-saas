import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase.js";
import type { EmailAccount } from "../lib/types.js";
import {
  useAccounts,
  useBillingState,
  usePortal,
  useRemoveAccount,
  useUpdateAccount,
} from "../lib/queries.js";
import { PlansModal } from "../components/PlansModal.js";
import { ConnectAccountModal } from "../components/ConnectAccountModal.js";
import { toast } from "../lib/toast.js";

type Pane = "profile" | "accounts" | "plan";

// Settings in the kit's .set-main layout: side nav + panes for Profile,
// Accounts (real management) and Plan & billing.
export function Settings() {
  const [params, setParams] = useSearchParams();
  const pane = (params.get("pane") as Pane) || "profile";

  function setPane(p: Pane) {
    const next = new URLSearchParams(params);
    next.set("pane", p);
    setParams(next, { replace: true });
  }

  return (
    <div className="set-main" style={{ flex: 1, minWidth: 0 }}>
      <nav className="set-nav">
        <h2>Settings</h2>
        <button className={`side-item ${pane === "profile" ? "active" : ""}`} onClick={() => setPane("profile")}>
          Profile
        </button>
        <button className={`side-item ${pane === "accounts" ? "active" : ""}`} onClick={() => setPane("accounts")}>
          Accounts
        </button>
        <button className={`side-item ${pane === "plan" ? "active" : ""}`} onClick={() => setPane("plan")}>
          Plan &amp; billing
        </button>
      </nav>
      <div className="set-content">
        {pane === "profile" && <ProfilePane />}
        {pane === "accounts" && <AccountsPane />}
        {pane === "plan" && <PlanPane />}
      </div>
    </div>
  );
}

function ProfilePane() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setName((data.user?.user_metadata?.full_name as string | undefined) ?? "");
    });
  }, []);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
    if (error) setErr(error.message);
    else toast("Profile saved");
    setBusy(false);
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) return setErr("Password must be at least 8 characters.");
    if (password !== password2) return setErr("Passwords do not match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setErr(error.message);
    else {
      toast("Password updated");
      setPassword("");
      setPassword2("");
    }
    setBusy(false);
  }

  return (
    <div className="set-pane active">
      <h1>Profile</h1>
      <p className="p-sub">Your name and login details.</p>

      <form className="set-card" onSubmit={saveProfile}>
        <h4>Profile</h4>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="field">
          <label>Email</label>
          <input value={user?.email ?? ""} disabled style={{ opacity: 0.6 }} />
        </div>
        <div style={{ marginTop: 18 }}>
          <button type="submit" className="btn-black" style={{ width: "auto", padding: "0 26px", height: 44, fontSize: 14 }} disabled={busy}>
            Save profile
          </button>
        </div>
      </form>

      <form className="set-card" onSubmit={savePassword}>
        <h4>Password</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
        </div>
        {err && <p className="err">{err}</p>}
        <div style={{ marginTop: 18 }}>
          <button type="submit" className="btn-black" style={{ width: "auto", padding: "0 26px", height: 44, fontSize: 14 }} disabled={busy || !password}>
            Update password
          </button>
        </div>
      </form>

      <div className="set-card danger-zone">
        <h4>Log out</h4>
        <p style={{ marginTop: 8, fontSize: 13.5, color: "var(--ink2)" }}>
          Signs you out of Uni-Inbox on this device.
        </p>
        <div style={{ marginTop: 14 }}>
          <button className="btn-mini danger" onClick={() => void supabase.auth.signOut()}>
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

function AccountsPane() {
  const { data: accounts, isLoading } = useAccounts();
  const { data: billing } = useBillingState();
  const [connectOpen, setConnectOpen] = useState(false);

  return (
    <div className="set-pane active">
      <h1>Accounts</h1>
      <p className="p-sub">
        {billing
          ? `${billing.connected_inboxes} of ${billing.max_inboxes} accounts used on the ${billing.plan_label} plan.`
          : "Your connected inboxes."}
      </p>

      <div className="set-card">
        {isLoading ? (
          <p style={{ fontSize: 14, color: "var(--ink3)" }}>Loading…</p>
        ) : (accounts ?? []).length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--ink3)" }}>No inboxes connected yet.</p>
        ) : (
          (accounts ?? []).map((a) => <AccountRow key={a.id} account={a} />)
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <button className="btn-black" style={{ width: "auto", padding: "0 30px", height: 46, fontSize: 14.5 }} onClick={() => setConnectOpen(true)}>
          Add account
        </button>
      </div>

      {connectOpen && <ConnectAccountModal onClose={() => setConnectOpen(false)} />}
    </div>
  );
}

function AccountRow({ account }: { account: EmailAccount }) {
  const update = useUpdateAccount();
  const remove = useRemoveAccount();
  const [fixOpen, setFixOpen] = useState(false);
  const [password, setPassword] = useState("");

  return (
    <div className="acc-row" style={{ flexWrap: "wrap" }}>
      <span className="pdot" style={{ background: account.color }} />
      <div style={{ minWidth: 0 }}>
        <div className="a-name">
          {account.label}
          {account.status === "auth_failed" && (
            <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, color: "#EA4335" }}>
              Sign in failed
            </span>
          )}
          {account.status === "disabled" && (
            <span style={{ marginLeft: 8, fontSize: 11.5, fontWeight: 700, color: "var(--ink3)" }}>
              Paused
            </span>
          )}
        </div>
        <div className="a-mail">{account.email_address}</div>
      </div>
      <div className="a-acts">
        <button className="btn-mini" onClick={() => setFixOpen((v) => !v)}>
          Update password
        </button>
        {account.status === "disabled" ? (
          <button
            className="btn-mini"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: account.id, status: "active" })}
          >
            Resume
          </button>
        ) : (
          <button
            className="btn-mini"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: account.id, status: "disabled" })}
          >
            Pause
          </button>
        )}
        <button
          className="btn-mini danger"
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Remove ${account.email_address}? Its synced mail disappears from Uni-Inbox (the mailbox itself is untouched).`,
              )
            ) {
              remove.mutate(account.id, { onSuccess: () => toast("Account removed") });
            }
          }}
        >
          Remove
        </button>
      </div>

      {account.last_error && account.status !== "active" && (
        <p className="err" style={{ width: "100%" }}>{account.last_error}</p>
      )}

      {fixOpen && (
        <form
          style={{ display: "flex", gap: 8, width: "100%", marginTop: 4 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!password) return;
            update.mutate(
              { id: account.id, password },
              {
                onSuccess: () => {
                  setFixOpen(false);
                  setPassword("");
                  toast("Password updated, reconnecting");
                },
              },
            );
          }}
        >
          <input
            style={{ flex: 1, height: 40, borderRadius: 12, border: "1px solid var(--line)", background: "#f7fafd", padding: "0 14px", fontSize: 14, outline: "none" }}
            type="password"
            autoComplete="off"
            placeholder="New password / app password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn-mini" type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      )}
      {(update.error || remove.error) && (
        <p className="err" style={{ width: "100%" }}>
          {((update.error ?? remove.error) as Error).message}
        </p>
      )}
    </div>
  );
}

function PlanPane() {
  const { data: billing } = useBillingState();
  const portal = usePortal();
  const [plansOpen, setPlansOpen] = useState(false);

  const trialDaysLeft = billing?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(billing.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : null;
  const usagePct = billing ? Math.min(100, Math.round((billing.connected_inboxes / billing.max_inboxes) * 100)) : 0;

  return (
    <div className="set-pane active">
      <h1>Plan &amp; billing</h1>
      <p className="p-sub">Your subscription and connected-account allowance.</p>

      <div className="plan-hero">
        <div className="ph-tier">{billing?.plan_label ?? "…"}</div>
        <div className="ph-price">
          {billing
            ? billing.plan === "trial"
              ? billing.trial_expired
                ? "Trial ended"
                : `Free trial, ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`
              : billing.price_label
            : ""}
        </div>
        <div className="ph-desc">
          {billing?.plan === "trial"
            ? "Pick a plan anytime. Nothing is deleted when you switch."
            : billing?.plan === "monthly"
              ? `${billing.pricing.monthly_included} accounts included, $${billing.pricing.monthly_per_extra_usd}/month per extra. Switch or cancel anytime.`
              : "Every future update included, forever. Thanks for backing Uni-Inbox."}
        </div>
        {billing && (
          <div className="usage">
            <div className="u-bar">
              <div className="u-fill" style={{ width: `${usagePct}%` }} />
            </div>
            <div className="u-txt">
              {billing.connected_inboxes} of {billing.max_inboxes} accounts used
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn-black" style={{ width: "auto", padding: "0 28px", height: 46, fontSize: 14.5 }} onClick={() => setPlansOpen(true)}>
          See plans
        </button>
        {billing && billing.plan !== "trial" && (
          <button className="btn-ghost" disabled={portal.isPending} onClick={() => portal.mutate()}>
            {portal.isPending ? "Opening…" : "Manage billing"}
          </button>
        )}
      </div>
      {portal.error && <p className="err">{(portal.error as Error).message}</p>}

      {plansOpen && <PlansModal onClose={() => setPlansOpen(false)} />}
    </div>
  );
}
