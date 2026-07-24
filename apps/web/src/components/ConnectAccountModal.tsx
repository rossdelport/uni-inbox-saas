import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AccountInput, DiscoverResult, TestResult } from "../lib/types.js";
import {
  useAddSeat,
  useBillingState,
  useCheckout,
  useConnectAccount,
  useDiscover,
  useOauthProviders,
  useOauthStart,
  useTestConnection,
} from "../lib/queries.js";
import { ModalShell, PlansModal } from "./PlansModal.js";
import { ColorDots } from "./ColorDots.js";
import { toast } from "../lib/toast.js";

type ProviderKey = "gmail" | "icloud" | "outlook" | "custom";

const PROVIDERS: Record<
  ProviderKey,
  { label: string; sub: string }
> = {
  gmail: { label: "Gmail", sub: "Google accounts" },
  icloud: { label: "iCloud Mail", sub: "Apple accounts" },
  outlook: { label: "Outlook", sub: "Microsoft accounts" },
  custom: { label: "My own domain", sub: "you@yourbusiness.com" },
};

const HOSTS: Record<Exclude<ProviderKey, "custom">, Pick<AccountInput, "imap_host" | "imap_port" | "smtp_host" | "smtp_port" | "smtp_security">> = {
  gmail: { imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 465, smtp_security: "tls" },
  icloud: { imap_host: "imap.mail.me.com", imap_port: 993, smtp_host: "smtp.mail.me.com", smtp_port: 587, smtp_security: "starttls" },
  outlook: { imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587, smtp_security: "starttls" },
};

// Connect-an-account modal. At the plan limit it becomes the paywall.
export function ConnectAccountModal({ onClose }: { onClose: () => void }) {
  const { data: billing } = useBillingState();
  const checkout = useCheckout();
  const addSeat = useAddSeat();
  const [plansOpen, setPlansOpen] = useState(false);

  const atLimit = billing ? billing.connected_inboxes >= billing.max_inboxes : false;

  if (plansOpen) return <PlansModal onClose={onClose} />;
  if (billing && atLimit) {
    const p = billing.pricing;
    return (
      <ModalShell
        title="Your plan is full"
        sub={
          billing.plan === "lifetime"
            ? "Lifetime covers up to 10 accounts. Remove one in Settings to make room."
            : "Grow it in place: add a single account, or unlock ten with Lifetime."
        }
        onClose={onClose}
      >
        <div className="m-limit">
          <div className="m-limit-num">
            {billing.connected_inboxes} of {billing.max_inboxes}
          </div>
          <div className="m-limit-txt">
            accounts used on your <b>{billing.plan_label}</b> plan ({billing.price_label})
          </div>
        </div>
        {billing.plan !== "lifetime" && (
          <div className="m-upsell">
            {billing.plan === "monthly" ? (
              <button
                className="btn-black"
                style={{ height: 46, fontSize: 14 }}
                disabled={addSeat.isPending}
                onClick={() =>
                  addSeat.mutate(undefined, {
                    onSuccess: ({ quantity }) => toast(`Plan updated: up to ${quantity} accounts`, "success"),
                  })
                }
              >
                {addSeat.isPending
                  ? "Updating plan…"
                  : `Add one more account, +$${p.monthly_per_extra_usd}/month`}
              </button>
            ) : (
              <button
                className="btn-black"
                style={{ height: 46, fontSize: 14 }}
                disabled={checkout.isPending}
                onClick={() => checkout.mutate("monthly")}
              >
                {checkout.isPending
                  ? "Redirecting…"
                  : `Go Monthly, $${p.monthly_base_usd}/month for ${p.monthly_included} accounts`}
              </button>
            )}
            <button
              className="btn-ghost"
              disabled={checkout.isPending}
              onClick={() => checkout.mutate("lifetime")}
            >
              Go Lifetime, ${p.lifetime_usd} once, {p.lifetime_max} accounts
            </button>
          </div>
        )}
        {(addSeat.error || checkout.error) && (
          <p className="err">{((addSeat.error ?? checkout.error) as Error).message}</p>
        )}
      </ModalShell>
    );
  }
  return (
    <ModalShell
      title="Connect an account"
      sub="Pick where your mail lives. It joins your unified inbox and starts syncing."
      onClose={onClose}
    >
      <ConnectForm
        onConnected={onClose}
        usedAfter={billing ? billing.connected_inboxes + 1 : null}
        max={billing?.max_inboxes ?? null}
      />
    </ModalShell>
  );
}

export function ConnectForm({
  onConnected,
  usedAfter = null,
  max = null,
}: {
  onConnected: (label: string, email: string) => void;
  usedAfter?: number | null;
  max?: number | null;
}) {
  const { data: oauth } = useOauthProviders();
  const oauthStart = useOauthStart();
  const discover = useDiscover();
  const [sel, setSel] = useState<ProviderKey>("gmail");
  const [discovery, setDiscovery] = useState<DiscoverResult | null>(null);
  const discoverTimer = useRef<ReturnType<typeof setTimeout>>();

  const [form, setForm] = useState<AccountInput>({
    label: "",
    email_address: "",
    provider_preset: "gmail",
    ...HOSTS.gmail,
    imap_username: "",
    password: "",
  });
  const [test, setTest] = useState<TestResult | null>(null);
  const testMutation = useTestConnection();
  const connect = useConnectAccount();

  function pick(k: ProviderKey) {
    setSel(k);
    setTest(null);
    setDiscovery(null);
    setForm((f) => ({
      ...f,
      provider_preset: k,
      ...(k === "custom" ? { imap_host: "", smtp_host: "" } : HOSTS[k]),
    }));
  }

  function set<K extends keyof AccountInput>(key: K, value: AccountInput[K]) {
    setTest(null);
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "email_address" && typeof value === "string") {
        if (!f.imap_username || f.imap_username === f.email_address) next.imap_username = value;
        if (!f.label) next.label = value.split("@")[1] ?? value;
      }
      return next;
    });
    // Own-domain flow: look up where this domain's mail routes and prefill.
    // Only once the address is complete (has a dot in the domain), so we
    // never guess against a half-typed domain.
    if (
      key === "email_address" &&
      sel === "custom" &&
      typeof value === "string" &&
      /@[^@\s]+\.[^@\s]{2,}$/.test(value)
    ) {
      clearTimeout(discoverTimer.current);
      discoverTimer.current = setTimeout(() => {
        discover.mutate(value, {
          onSuccess: (d) => {
            setDiscovery(d);
            if (d.imap_host) {
              setForm((f) => ({
                ...f,
                imap_host: d.imap_host,
                imap_port: d.imap_port,
                smtp_host: d.smtp_host,
                smtp_port: d.smtp_port,
                smtp_security: d.smtp_security,
              }));
            }
          },
        });
      }, 500);
    }
  }

  async function runTest() {
    setTest(null);
    const result = await testMutation.mutateAsync(form).catch((err) => ({
      imap_ok: false,
      smtp_ok: false,
      error: (err as Error).message,
    }));
    setTest(result);
    return result;
  }

  function doConnect() {
    connect.mutate(form, {
      onSuccess: (acct) => {
        toast(`${acct.label} connected: ${acct.email_address}`, "success");
        onConnected(acct.label, acct.email_address);
      },
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = test ?? (await runTest());
    if (!result.imap_ok || !result.smtp_ok) return;
    doConnect();
  }

  const oauthReady = sel === "gmail" ? oauth?.google : sel === "outlook" ? oauth?.microsoft : false;
  const oauthProvider = sel === "gmail" ? "google" : "microsoft";
  const passwordFlow = sel === "icloud" || sel === "custom" || (sel === "gmail" && !oauth?.google) || (sel === "outlook" && oauth && !oauth.microsoft);

  return (
    <div>
      <div className="m-provs">
        {(Object.keys(PROVIDERS) as ProviderKey[]).map((k) => (
          <button
            key={k}
            type="button"
            className={`m-prov ${sel === k ? "sel" : ""}`}
            onClick={() => pick(k)}
          >
            <ProviderLogo k={k} />
            <span style={{ minWidth: 0, textAlign: "left" }}>
              {PROVIDERS[k].label}
              <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--ink3)" }}>
                {PROVIDERS[k].sub}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* OAuth path: one button, zero passwords */}
      {(sel === "gmail" || sel === "outlook") && oauthReady && (
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            className="btn-black"
            style={{ width: "100%", height: 48, fontSize: 15, gap: 10 }}
            disabled={oauthStart.isPending}
            onClick={() => oauthStart.mutate(oauthProvider)}
          >
            {sel === "gmail" ? <GoogleG dark /> : <MsLogo />}
            {oauthStart.isPending
              ? "Opening…"
              : sel === "gmail"
                ? "Continue with Google"
                : "Continue with Microsoft"}
          </button>
          {oauthStart.error && <p className="err">{(oauthStart.error as Error).message}</p>}
          <p style={{ marginTop: 10, fontSize: 12, color: "var(--ink3)", textAlign: "center", lineHeight: 1.5 }}>
            {sel === "gmail" ? "Google" : "Microsoft"} will ask you to approve OneInbox reading and
            sending your mail. No passwords, revoke anytime from your account.
          </p>
        </div>
      )}

      {sel === "outlook" && oauth && !oauth.microsoft && (
        <p style={{ marginTop: 16, fontSize: 13, color: "var(--ink2)", lineHeight: 1.5 }}>
          Outlook connections are coming shortly. Microsoft requires app approval that is still in
          progress.
        </p>
      )}

      {/* Password path: iCloud, own domains, and fallbacks */}
      {passwordFlow && sel !== "outlook" && (
        <form onSubmit={onSubmit}>
          {sel === "gmail" && (
            <p className="m-note">
              Gmail needs an app password: turn on 2 step verification, then create one at{" "}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                myaccount.google.com/apppasswords
              </a>{" "}
              and paste it below.
            </p>
          )}
          {sel === "icloud" && (
            <p className="m-note">
              iCloud needs an app-specific password: create one at{" "}
              <a href="https://account.apple.com/account/manage" target="_blank" rel="noreferrer">
                account.apple.com
              </a>{" "}
              under Sign-In and Security, then paste it below.
            </p>
          )}

          <div className="field" style={{ marginTop: 14 }}>
            <label>Email address</label>
            <input
              type="email"
              required
              placeholder={
                sel === "gmail" ? "name@gmail.com" : sel === "icloud" ? "name@icloud.com" : "you@yourbusiness.com"
              }
              value={form.email_address}
              onChange={(e) => set("email_address", e.target.value)}
            />
          </div>

          {sel === "custom" &&
            form.email_address.includes("@") &&
            !/@[^@\s]+\.[^@\s]{2,}$/.test(form.email_address) && (
              <div className="m-note" style={{ marginTop: 10 }}>
                Finish typing your full address including the ending, like <b>.com</b> or{" "}
                <b>.com.au</b>. We detect your email host and fill in the servers automatically.
              </div>
            )}

          {sel === "custom" && (discover.isPending || discovery) && (
            <div className="m-note" style={{ marginTop: 10 }}>
              {discover.isPending ? (
                "Looking up where this domain's mail lives…"
              ) : discovery?.detected ? (
                <>
                  <b>{discovery.detected}</b> detected. Server settings are filled in, just add the
                  mailbox password from your email host.
                </>
              ) : (
                (discovery?.note ?? "")
              )}
              {discovery?.detected && discovery.note && <> {discovery.note}</>}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>{sel === "gmail" || sel === "icloud" ? "App password" : "Mailbox password"}</label>
              <input
                type="password"
                required
                autoComplete="off"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </div>
            <div className="field">
              <label>Label in your sidebar</label>
              <input
                required
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder="e.g. Solar Cleaning"
              />
            </div>
          </div>

          <div className="field">
            <label>Colour</label>
            <ColorDots value={form.color} onChange={(c) => set("color", c)} />
          </div>

          <details className="m-server" open={sel === "custom" && !discovery?.detected && Boolean(form.email_address)}>
            <summary>Server settings</summary>
            <div className="field">
              <label>Username</label>
              <input required value={form.imap_username} onChange={(e) => set("imap_username", e.target.value)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field">
                <label>IMAP host</label>
                <input required value={form.imap_host} onChange={(e) => set("imap_host", e.target.value)} />
              </div>
              <div className="field">
                <label>IMAP port</label>
                <input type="number" required value={form.imap_port} onChange={(e) => set("imap_port", Number(e.target.value))} />
              </div>
              <div className="field">
                <label>SMTP host</label>
                <input required value={form.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} />
              </div>
              <div className="field">
                <label>SMTP port</label>
                <input type="number" required value={form.smtp_port} onChange={(e) => set("smtp_port", Number(e.target.value))} />
              </div>
            </div>
            <div className="field">
              <label>SMTP security</label>
              <select value={form.smtp_security} onChange={(e) => set("smtp_security", e.target.value as "tls" | "starttls")}>
                <option value="tls">TLS (port 465)</option>
                <option value="starttls">STARTTLS (port 587)</option>
              </select>
            </div>
          </details>

          {test && (
            <p className={test.imap_ok && test.smtp_ok ? "ok-note" : "err"}>
              {test.imap_ok ? "✓ IMAP" : "✕ IMAP"} · {test.smtp_ok ? "✓ SMTP" : "✕ SMTP"}
              {test.error ? ` · ${test.error}` : ""}
            </p>
          )}
          {test && test.imap_ok && !test.smtp_ok && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn-ghost"
                style={{ width: "100%" }}
                disabled={connect.isPending}
                onClick={doConnect}
              >
                {connect.isPending ? "Connecting…" : "Connect anyway, receive only for now"}
              </button>
              <p style={{ marginTop: 6, fontSize: 12, color: "var(--ink3)", textAlign: "center" }}>
                Mail syncs and reads normally. Sending turns on once the outgoing server is reachable.
              </p>
            </div>
          )}
          {connect.error && <p className="err">{(connect.error as Error).message}</p>}

          <button
            type="submit"
            className="btn-black"
            style={{ width: "100%", height: 46, fontSize: 14.5, marginTop: 16 }}
            disabled={connect.isPending || testMutation.isPending}
          >
            {testMutation.isPending ? "Testing connection…" : connect.isPending ? "Connecting…" : "Connect account"}
          </button>
        </form>
      )}

      <p style={{ marginTop: 12, fontSize: 11.5, color: "var(--ink3)", textAlign: "center" }}>
        We test the connection before saving.
        {usedAfter !== null && max !== null && <> {Math.min(usedAfter, max)} of {max} accounts used after this.</>}
      </p>
    </div>
  );
}

function ProviderLogo({ k }: { k: ProviderKey }) {
  const box = { width: 22, height: 22, flex: "none" } as const;
  if (k === "gmail")
    return (
      <svg style={box} viewBox="0 0 24 18">
        <path d="M1.6 18h3.2V8.3L0 4.9v11.5C0 17.3.7 18 1.6 18Z" fill="#4285F4" />
        <path d="M19.2 18h3.2c.9 0 1.6-.7 1.6-1.6V4.9l-4.8 3.4V18Z" fill="#34A853" />
        <path d="M19.2 1.6v6.7L24 4.9V2.4c0-2-2.3-3.1-3.9-1.9l-.9.7v.4Z" fill="#FBBC04" />
        <path d="M4.8 8.3V1.6L12 7l7.2-5.4v6.7L12 13.7 4.8 8.3Z" fill="#EA4335" />
        <path d="M0 2.4v2.5l4.8 3.4V1.6l-.9-.7C2.3-.3 0 .9 0 2.4Z" fill="#C5221F" />
      </svg>
    );
  if (k === "icloud")
    return (
      <svg style={box} viewBox="0 0 24 24" fill="#111">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    );
  if (k === "outlook")
    return (
      <svg style={box} viewBox="0 0 24 24">
        <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
        <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
        <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
        <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
      </svg>
    );
  return (
    <svg style={box} viewBox="0 0 24 24" fill="none" stroke="#00B050" strokeWidth="1.9">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.8 12h18.4M12 2.5c2.7 2.6 4 5.9 4 9.5s-1.3 6.9-4 9.5c-2.7-2.6-4-5.9-4-9.5s1.3-6.9 4-9.5Z" />
    </svg>
  );
}

function GoogleG({ dark }: { dark?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.5 13.3l7.9 6.2C12.3 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
      <path fill="#FBBC05" d="M10.4 28.5c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.2z" />
      <path fill={dark ? "#fff" : "#34A853"} d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.2-13.6-10l-7.9 6.2C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
function MsLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
      <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
      <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
      <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
    </svg>
  );
}
