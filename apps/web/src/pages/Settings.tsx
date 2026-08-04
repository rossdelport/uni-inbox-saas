import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase.js";
import type { EmailAccount } from "../lib/types.js";
import {
  useAccounts,
  useAiCheckout,
  useBillingState,
  useCreateSnippet,
  useDeleteSnippet,
  useOauthStart,
  usePortal,
  useRemoveAccount,
  useSnippets,
  useUpdateAccount,
  useDetectSignature,
} from "../lib/queries.js";
import { PlansModal } from "../components/PlansModal.js";
import { ConnectAccountModal } from "../components/ConnectAccountModal.js";
import { ColorDots } from "../components/ColorDots.js";
import { toast } from "../lib/toast.js";
import { PasswordInput } from "../components/PasswordInput.js";

type Pane = "profile" | "accounts" | "snippets" | "plan";

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
        <button className={`side-item ${pane === "snippets" ? "active" : ""}`} onClick={() => setPane("snippets")}>
          Snippets
        </button>
        <button className={`side-item ${pane === "plan" ? "active" : ""}`} onClick={() => setPane("plan")}>
          Plan &amp; billing
        </button>
      </nav>
      <div className="set-content">
        {pane === "profile" && <ProfilePane />}
        {pane === "accounts" && <AccountsPane />}
        {pane === "snippets" && <SnippetsPane />}
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
    else toast("Profile saved", "success");
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
      toast("Password updated", "success");
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
          <button type="submit" className="btn-black btn-auto" disabled={busy}>
            Save profile
          </button>
        </div>
      </form>

      <form className="set-card" onSubmit={savePassword}>
        <h4>Password</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="field">
            <label>New password</label>
            <PasswordInput
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
        </div>
        {err && <p className="err">{err}</p>}
        <div style={{ marginTop: 18 }}>
          <button type="submit" className="btn-black btn-auto" disabled={busy || !password}>
            Update password
          </button>
        </div>
      </form>

      <div className="set-card danger-zone">
        <h4>Log out</h4>
        <p style={{ marginTop: 8, fontSize: 13.5, color: "var(--ink2)" }}>
          Signs you out of OneInbox on this device.
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
        <button className="btn-black btn-auto" onClick={() => setConnectOpen(true)}>
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
  const oauthStart = useOauthStart();
  // OAuth accounts have no password: their fix path is a fresh provider
  // sign-in, which the callback applies to this same row in place.
  const oauthProvider =
    account.auth_method === "oauth_google"
      ? ("google" as const)
      : account.auth_method === "oauth_microsoft"
        ? ("microsoft" as const)
        : null;
  const [fixOpen, setFixOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [label, setLabel] = useState(account.label);
  const [color, setColor] = useState(account.color);
  const [sigOpen, setSigOpen] = useState(false);
  const detectSig = useDetectSignature();
  // A detected-but-unsaved candidate; saving copies it onto the account.
  const [sigCandidate, setSigCandidate] = useState<{ html: string; text: string } | null>(null);

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
        <button
          className="btn-mini"
          onClick={() => {
            setEditOpen((v) => !v);
            setLabel(account.label);
            setColor(account.color);
          }}
        >
          Edit
        </button>
        {oauthProvider ? (
          <button
            className="btn-mini"
            disabled={oauthStart.isPending}
            onClick={() => oauthStart.mutate(oauthProvider)}
          >
            Reconnect
          </button>
        ) : (
          <button className="btn-mini" onClick={() => setFixOpen((v) => !v)}>
            Update password
          </button>
        )}
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
        <button className="btn-mini" onClick={() => setSigOpen((v) => !v)}>
          Signature
        </button>
        <button
          className="btn-mini danger"
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Remove ${account.email_address}? Its synced mail disappears from OneInbox (the mailbox itself is untouched).`,
              )
            ) {
              remove.mutate(account.id, { onSuccess: () => toast("Account removed", "danger") });
            }
          }}
        >
          Remove
        </button>
      </div>

      {account.last_error && account.status !== "active" && (
        <p className="err" style={{ width: "100%" }}>{account.last_error}</p>
      )}

      {sigOpen && (
        <div style={{ width: "100%", marginTop: 6, padding: "12px 14px", background: "#f7f9fb", borderRadius: 14, border: "1px solid var(--line)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
            Signature for {account.email_address}
          </div>
          {sigCandidate ? (
            <>
              <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 8px" }}>
                Found in your sent mail. This is exactly what your replies already end with:
              </p>
              <div
                style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", fontSize: 13, overflow: "auto", maxHeight: 220 }}
                dangerouslySetInnerHTML={{ __html: sigCandidate.html }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  className="btn-mini"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate(
                      { id: account.id, signature_html: sigCandidate.html, signature_text: sigCandidate.text },
                      {
                        onSuccess: () => {
                          setSigCandidate(null);
                          toast("Signature saved. New replies will end with it.", "success");
                        },
                      },
                    )
                  }
                >
                  Use this signature
                </button>
                <button className="btn-mini" onClick={() => setSigCandidate(null)}>
                  Discard
                </button>
              </div>
            </>
          ) : account.signature_html ? (
            <>
              <div
                style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", fontSize: 13, overflow: "auto", maxHeight: 220 }}
                dangerouslySetInnerHTML={{ __html: account.signature_html }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  className="btn-mini"
                  disabled={detectSig.isPending}
                  onClick={() =>
                    detectSig.mutate(account.id, {
                      onSuccess: (r) => {
                        if (r.found && r.signature_html) {
                          setSigCandidate({ html: r.signature_html, text: r.signature_text ?? "" });
                        } else {
                          toast(
                            r.reason === "no_sent"
                              ? "No sent mail synced yet for this account."
                              : "Could not find a consistent signature in your sent mail.",
                            "warn",
                          );
                        }
                      },
                      onError: () => toast("Could not scan sent mail. Try again.", "warn"),
                    })
                  }
                >
                  {detectSig.isPending ? "Scanning…" : "Re-detect from sent mail"}
                </button>
                <button
                  className="btn-mini danger"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate(
                      { id: account.id, signature_html: null, signature_text: null },
                      { onSuccess: () => toast("Signature removed", "danger") },
                    )
                  }
                >
                  Remove signature
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 8px" }}>
                No signature yet. OneInbox can lift the one you already use from this
                account's sent mail, identical to how it appears today.
              </p>
              <button
                className="btn-mini"
                disabled={detectSig.isPending}
                onClick={() =>
                  detectSig.mutate(account.id, {
                    onSuccess: (r) => {
                      if (r.found && r.signature_html) {
                        setSigCandidate({ html: r.signature_html, text: r.signature_text ?? "" });
                      } else {
                        toast(
                          r.reason === "no_sent"
                            ? "No sent mail synced yet for this account."
                            : "Could not find a consistent signature in your sent mail.",
                          "warn",
                        );
                      }
                    },
                    onError: () => toast("Could not scan sent mail. Try again.", "warn"),
                  })
                }
              >
                {detectSig.isPending ? "Scanning sent mail…" : "Detect from sent mail"}
              </button>
            </>
          )}
        </div>
      )}

      {editOpen && (
        <form
          style={{ display: "flex", gap: 8, width: "100%", marginTop: 4, alignItems: "center", flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!label.trim()) return;
            update.mutate(
              { id: account.id, label: label.trim(), color },
              {
                onSuccess: () => {
                  setEditOpen(false);
                  toast("Account updated", "success");
                },
              },
            );
          }}
        >
          <input
            style={{ flex: 1, minWidth: 160, height: 40, borderRadius: 12, border: "1px solid var(--line)", background: "#fff", padding: "0 14px", fontSize: 14, outline: "none" }}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label in your sidebar"
          />
          <ColorDots value={color} onChange={setColor} />
          <button className="btn-mini" type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </form>
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
                  toast("Password updated, reconnecting", "success");
                },
              },
            );
          }}
        >
          <PasswordInput
            wrapperStyle={{ flex: 1 }}
            style={{ width: "100%", height: 40, borderRadius: 12, border: "1px solid var(--line)", background: "#fff", padding: "0 14px", fontSize: 14, outline: "none" }}
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

// Saved reply blocks. Kept deliberately plain: a list and one add form.
// Inserted in the composer via the lightning button or by typing ;shortcut
// followed by a space.
function SnippetsPane() {
  const { data } = useSnippets();
  const create = useCreateSnippet();
  const del = useDeleteSnippet();
  const [shortcut, setShortcut] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const snippets = data?.snippets ?? [];

  function add() {
    if (!shortcut.trim() || !name.trim() || !body.trim()) return;
    create.mutate(
      { shortcut: shortcut.trim(), name: name.trim(), body_text: body },
      {
        onSuccess: () => {
          setShortcut("");
          setName("");
          setBody("");
          toast("Snippet saved.", "success");
        },
        onError: (e) => toast((e as Error).message, "warn"),
      },
    );
  }

  return (
    <div className="set-pane active">
      <h1>Snippets</h1>
      <p className="p-sub">
        Things you type a lot, ready to drop into any reply: the lightning button in the
        composer, or type ;shortcut then a space.
      </p>

      <div className="set-card">
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8 }}>
          <div className="field" style={{ marginTop: 0 }}>
            <label>Shortcut</label>
            <input placeholder="intro" value={shortcut} onChange={(e) => setShortcut(e.target.value)} />
          </div>
          <div className="field" style={{ marginTop: 0 }}>
            <label>Name</label>
            <input placeholder="Intro reply" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Text</label>
          <textarea
            style={{ minHeight: 88 }}
            placeholder="Thanks for reaching out..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <button
          className="btn-black btn-auto"
          style={{ marginTop: 10 }}
          disabled={create.isPending || !shortcut.trim() || !name.trim() || !body.trim()}
          onClick={add}
        >
          {create.isPending ? "Saving…" : "Save snippet"}
        </button>
      </div>

      {snippets.map((sn) => (
        <div key={sn.id} className="set-card snip-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="snip-head">
              <b>{sn.name}</b>
              <code>;{sn.shortcut}</code>
            </div>
            <p className="snip-body">{sn.body_text}</p>
          </div>
          <button
            className="btn-mini"
            disabled={del.isPending}
            onClick={() => del.mutate(sn.id, { onError: (e) => toast((e as Error).message, "warn") })}
          >
            Delete
          </button>
        </div>
      ))}
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
              : billing?.plan === "yearly"
                ? `${billing.pricing.monthly_included} accounts included, $${billing.pricing.yearly_base_usd}/year with 20% off. Switch or cancel anytime.`
              : "Every future update included, forever. Thanks for backing OneInbox."}
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
        <button className="btn-black btn-auto" onClick={() => setPlansOpen(true)}>
          See plans
        </button>
        {billing && billing.plan !== "trial" && (
          <button className="btn-ghost" disabled={portal.isPending} onClick={() => portal.mutate()}>
            {portal.isPending ? "Opening…" : "Manage billing"}
          </button>
        )}
      </div>
      {portal.error && <p className="err">{(portal.error as Error).message}</p>}

      <AiAddonCard />

      {plansOpen && <PlansModal onClose={() => setPlansOpen(false)} />}
    </div>
  );
}

// The AI summaries add-on: a separate $3/month subscription, off by default.
// The honesty matters as much as the feature: the security promise is that no
// AI reads anyone's mail UNLESS they turn this on, so the card says exactly
// which mail is read, when, and by what.
function AiAddonCard() {
  const { data: billing } = useBillingState();
  const aiCheckout = useAiCheckout();
  const portal = usePortal();
  if (!billing) return null;
  const on = billing.ai_addon;

  return (
    <div className="set-card ai-addon">
      <div className="ai-addon-head">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" />
        </svg>
        <h2>AI summaries</h2>
        {on ? (
          <span className="ai-addon-state on">On</span>
        ) : (
          <span className="ai-addon-state">${billing.ai_price_usd}/month</span>
        )}
      </div>
      <p>
        A Summarize button on every conversation: two or three sentences on what it is
        about and what needs an answer, cached so re-opening a thread is instant.
      </p>
      <p className="ai-addon-fine">
        Off by default. When you press Summarize, that one conversation is sent to
        Anthropic&apos;s Claude to write the summary, and API traffic is not used to
        train models. Mail is never summarized in the background.
      </p>
      {on ? (
        <button className="btn-ghost" disabled={portal.isPending} onClick={() => portal.mutate()}>
          {portal.isPending ? "Opening…" : "Manage or cancel"}
        </button>
      ) : (
        <button
          className="btn-black btn-auto"
          disabled={aiCheckout.isPending}
          onClick={() => aiCheckout.mutate()}
        >
          {aiCheckout.isPending ? "Opening checkout…" : `Add for $${billing.ai_price_usd}/month`}
        </button>
      )}
      {aiCheckout.error && <p className="err">{(aiCheckout.error as Error).message}</p>}
    </div>
  );
}
