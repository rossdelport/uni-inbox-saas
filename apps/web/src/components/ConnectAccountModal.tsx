import { useEffect, useState, type FormEvent } from "react";
import type { AccountInput, ProviderPreset, TestResult } from "../lib/types.js";
import { api } from "../lib/api.js";
import {
  useAddSeat,
  useBillingState,
  useCheckout,
  useConnectAccount,
  useTestConnection,
} from "../lib/queries.js";
import { PROVIDER_COLORS } from "../lib/assets.js";
import { ModalShell, PlansModal } from "./PlansModal.js";
import { toast } from "../lib/toast.js";

interface Preset {
  id: ProviderPreset;
  label: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "tls" | "starttls";
}

const CARD_LABELS: Record<string, string> = {
  gmail: "Gmail",
  icloud: "iCloud",
  porkbun: "Porkbun",
  custom: "Other",
};
const HINTS: Record<string, string> = {
  gmail: "name@gmail.com",
  icloud: "name@icloud.com",
  porkbun: "you@yourdomain.com",
  custom: "you@yourdomain.com",
};

// Connect-an-account modal in the kit style. At the plan limit it becomes
// the paywall: Monthly users add a +$2 seat in place, everyone can jump to
// Lifetime, trial users get pushed into Monthly.
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
                style={{ height: 48, fontSize: 15 }}
                disabled={addSeat.isPending}
                onClick={() =>
                  addSeat.mutate(undefined, {
                    onSuccess: ({ quantity }) =>
                      toast(`Plan updated: up to ${quantity} accounts`),
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
                style={{ height: 48, fontSize: 15 }}
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
        <p style={{ marginTop: 14, fontSize: 12, color: "var(--ink3)", textAlign: "center" }}>
          {billing.plan === "monthly"
            ? "Extra accounts stay on your Monthly bill. Lifetime covers up to 10 with no monthly cost."
            : "Nothing gets deleted when you change plans."}
        </p>
      </ModalShell>
    );
  }
  return (
    <ModalShell
      title="Connect an account"
      sub="Pick a provider and sign in. It joins your unified inbox and starts syncing."
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
  const [presets, setPresets] = useState<Preset[]>([]);
  const [form, setForm] = useState<AccountInput>({
    label: "",
    email_address: "",
    provider_preset: "custom",
    imap_host: "",
    imap_port: 993,
    smtp_host: "",
    smtp_port: 465,
    smtp_security: "tls",
    imap_username: "",
    password: "",
  });
  const [test, setTest] = useState<TestResult | null>(null);
  const testMutation = useTestConnection();
  const connect = useConnectAccount();

  useEffect(() => {
    void api<Preset[]>("/api/accounts/presets")
      .then((list) => {
        setPresets(list);
        const gmail = list.find((p) => p.id === "gmail");
        if (gmail) applyPreset(gmail);
      })
      .catch(() => setPresets([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(p: Preset) {
    setTest(null);
    setForm((f) => ({
      ...f,
      provider_preset: p.id,
      imap_host: p.imap_host,
      imap_port: p.imap_port,
      smtp_host: p.smtp_host,
      smtp_port: p.smtp_port,
      smtp_security: p.smtp_security,
    }));
  }

  function set<K extends keyof AccountInput>(key: K, value: AccountInput[K]) {
    setTest(null);
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Username defaults to the address; label defaults to the domain.
      if (key === "email_address" && typeof value === "string") {
        if (!f.imap_username || f.imap_username === f.email_address) next.imap_username = value;
        if (!f.label) next.label = value.split("@")[1] ?? value;
      }
      return next;
    });
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
        toast(`${acct.label} connected: ${acct.email_address}`);
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

  const sel = form.provider_preset;

  return (
    <form onSubmit={onSubmit}>
        <div className="m-provs">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`m-prov ${sel === p.id ? "sel" : ""}`}
              onClick={() => applyPreset(p)}
            >
              <i style={{ background: PROVIDER_COLORS[p.id] ?? "#00B050" }} />
              {CARD_LABELS[p.id] ?? p.label}
            </button>
          ))}
        </div>

        {sel === "gmail" && (
          <p style={{ marginTop: 14, fontSize: 13, lineHeight: 1.5, color: "var(--ink2)" }}>
            Gmail needs an app password: turn on 2 step verification, then create one at{" "}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
              myaccount.google.com/apppasswords
            </a>{" "}
            and use it below.
          </p>
        )}
        {sel === "icloud" && (
          <p style={{ marginTop: 14, fontSize: 13, lineHeight: 1.5, color: "var(--ink2)" }}>
            iCloud needs an app-specific password: create one at{" "}
            <a href="https://account.apple.com/account/manage" target="_blank" rel="noreferrer">
              account.apple.com
            </a>{" "}
            under Sign-In and Security, then use it below.
          </p>
        )}

        <div className="field" style={{ marginTop: 18 }}>
          <label>Email address</label>
          <input
            type="email"
            required
            placeholder={HINTS[sel] ?? "you@yourdomain.com"}
            value={form.email_address}
            onChange={(e) => set("email_address", e.target.value)}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="field">
            <label>{sel === "gmail" || sel === "icloud" ? "App password" : "Password"}</label>
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

        <details className="m-server" open={sel === "custom"}>
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
              <input
                type="number"
                required
                value={form.imap_port}
                onChange={(e) => set("imap_port", Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>SMTP host</label>
              <input required value={form.smtp_host} onChange={(e) => set("smtp_host", e.target.value)} />
            </div>
            <div className="field">
              <label>SMTP port</label>
              <input
                type="number"
                required
                value={form.smtp_port}
                onChange={(e) => set("smtp_port", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="field">
            <label>SMTP security</label>
            <select
              value={form.smtp_security}
              onChange={(e) => set("smtp_security", e.target.value as "tls" | "starttls")}
            >
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
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ width: "100%" }}
              disabled={connect.isPending}
              onClick={doConnect}
            >
              {connect.isPending ? "Connecting…" : "Connect anyway, receive only for now"}
            </button>
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--ink3)", textAlign: "center" }}>
              Your mail will sync and read normally. Sending turns on by itself once the
              outgoing server is reachable.
            </p>
          </div>
        )}
        {connect.error && <p className="err">{(connect.error as Error).message}</p>}

        <div style={{ marginTop: 20 }}>
          <button
            type="submit"
            className="btn-black"
            style={{ height: 48, fontSize: 15, width: "100%" }}
            disabled={connect.isPending || testMutation.isPending}
          >
            {testMutation.isPending
              ? "Testing connection…"
              : connect.isPending
                ? "Connecting…"
                : "Connect account"}
          </button>
        </div>
      <p style={{ marginTop: 14, fontSize: 12, color: "var(--ink3)", textAlign: "center" }}>
        We test the connection before saving.
        {usedAfter !== null && max !== null && <> {Math.min(usedAfter, max)} of {max} accounts used after this.</>}
      </p>
    </form>
  );
}
