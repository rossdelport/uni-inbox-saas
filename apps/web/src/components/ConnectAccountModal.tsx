import { useEffect, useState, type FormEvent } from "react";
import type { AccountInput, ProviderPreset, TestResult } from "../lib/types.js";
import { api } from "../lib/api.js";
import { useBillingState, useConnectAccount, useTestConnection } from "../lib/queries.js";

interface Preset {
  id: ProviderPreset;
  label: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "tls" | "starttls";
}

const DOT_COLORS: Record<string, string> = {
  gmail: "#ea4335",
  icloud: "#3b82f6",
  porkbun: "#a855f7",
  custom: "#22c55e",
};

const CARD_LABELS: Record<string, string> = {
  gmail: "Gmail",
  icloud: "iCloud",
  porkbun: "Porkbun",
  custom: "Other",
};

// Connect-an-account flow: provider grid, credentials, test, save.
// Presets prefill hosts; every field stays editable for odd setups.
export function ConnectAccountModal({ onClose }: { onClose: () => void }) {
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
  const { data: billing } = useBillingState();

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = test ?? (await runTest());
    if (!result.imap_ok || !result.smtp_ok) return;
    connect.mutate(form, { onSuccess: onClose });
  }

  const selected = form.provider_preset;
  const usedAfter = billing ? Math.min(billing.connected_inboxes + 1, billing.max_inboxes) : null;
  const emailPlaceholder =
    selected === "gmail"
      ? "name@gmail.com"
      : selected === "icloud"
        ? "name@icloud.com"
        : "name@yourdomain.com";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-zinc-900/25 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[32px] bg-white p-7 shadow-[0_30px_80px_rgba(15,23,42,0.25)] sm:p-9"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-6 top-6 grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="text-[28px] font-bold tracking-tight text-zinc-900">Connect an account</h2>
        <p className="mt-1.5 text-[15px] text-zinc-500">
          Pick a provider and sign in. It joins your unified inbox instantly.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-5">
          {/* Provider grid */}
          <div className="grid grid-cols-2 gap-3">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex items-center gap-2.5 rounded-2xl border px-4 py-3.5 text-left text-[16px] font-semibold transition"
                style={
                  selected === p.id
                    ? { borderColor: "#1c7ef7", background: "#f2f7ff", color: "#18181b" }
                    : { borderColor: "#e4e4e7", color: "#18181b" }
                }
                onClick={() => applyPreset(p)}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: DOT_COLORS[p.id] ?? "#22c55e" }}
                />
                {CARD_LABELS[p.id] ?? p.label}
              </button>
            ))}
          </div>

          {selected === "gmail" && (
            <p className="rounded-xl bg-[#f2f7ff] px-4 py-2.5 text-[13px] leading-relaxed text-[#0a4fa8]">
              Gmail needs an app password: turn on 2 step verification, then create one at{" "}
              <a
                className="font-medium underline"
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
              >
                myaccount.google.com/apppasswords
              </a>{" "}
              and use it below.
            </p>
          )}
          {selected === "icloud" && (
            <p className="rounded-xl bg-[#f2f7ff] px-4 py-2.5 text-[13px] leading-relaxed text-[#0a4fa8]">
              iCloud needs an app-specific password: create one at{" "}
              <a
                className="font-medium underline"
                href="https://account.apple.com/account/manage"
                target="_blank"
                rel="noreferrer"
              >
                account.apple.com
              </a>{" "}
              under Sign-In and Security, then use it below.
            </p>
          )}

          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-zinc-500">
              Email address
            </label>
            <input
              className="input-auth"
              style={{ background: "#fff", borderColor: "#bcd7fb" }}
              type="email"
              required
              placeholder={emailPlaceholder}
              value={form.email_address}
              onChange={(e) => set("email_address", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[14px] font-medium text-zinc-500">
                {selected === "gmail" || selected === "icloud" ? "App password" : "Password"}
              </label>
              <input
                className="input-auth"
                type="password"
                required
                autoComplete="off"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[14px] font-medium text-zinc-500">
                Label in your sidebar
              </label>
              <input
                className="input-auth"
                required
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder="e.g. Solar Cleaning"
              />
            </div>
          </div>

          <details
            className="rounded-2xl border border-zinc-200 px-4 py-3"
            open={selected === "custom"}
          >
            <summary className="cursor-pointer text-[14px] font-medium text-zinc-600">
              Server settings
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-500">Username</label>
                <input
                  className="input-auth"
                  required
                  value={form.imap_username}
                  onChange={(e) => set("imap_username", e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-500">IMAP host</label>
                <input
                  className="input-auth"
                  required
                  value={form.imap_host}
                  onChange={(e) => set("imap_host", e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-500">IMAP port</label>
                <input
                  className="input-auth"
                  type="number"
                  required
                  value={form.imap_port}
                  onChange={(e) => set("imap_port", Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-500">SMTP host</label>
                <input
                  className="input-auth"
                  required
                  value={form.smtp_host}
                  onChange={(e) => set("smtp_host", e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-500">SMTP port</label>
                <input
                  className="input-auth"
                  type="number"
                  required
                  value={form.smtp_port}
                  onChange={(e) => set("smtp_port", Number(e.target.value))}
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-[13px] font-medium text-zinc-500">
                  SMTP security
                </label>
                <select
                  className="input-auth"
                  value={form.smtp_security}
                  onChange={(e) => set("smtp_security", e.target.value as "tls" | "starttls")}
                >
                  <option value="tls">TLS (port 465)</option>
                  <option value="starttls">STARTTLS (port 587)</option>
                </select>
              </div>
            </div>
          </details>

          {test && (
            <div className="flex items-center gap-4 rounded-xl bg-zinc-50 px-4 py-2.5 text-sm">
              <span className={test.imap_ok ? "text-emerald-600" : "text-red-600"}>
                {test.imap_ok ? "✓" : "✕"} IMAP
              </span>
              <span className={test.smtp_ok ? "text-emerald-600" : "text-red-600"}>
                {test.smtp_ok ? "✓" : "✕"} SMTP
              </span>
              {test.error && <span className="text-xs text-red-600">{test.error}</span>}
            </div>
          )}
          {connect.error && (
            <p className="text-sm text-red-600">{(connect.error as Error).message}</p>
          )}

          <button
            type="submit"
            className="w-full rounded-full bg-black py-3.5 text-[16px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={connect.isPending || testMutation.isPending}
          >
            {testMutation.isPending
              ? "Testing connection…"
              : connect.isPending
                ? "Connecting…"
                : "Connect account"}
          </button>

          <p className="text-center text-[13px] text-zinc-400">
            We test the connection before saving.
            {billing && usedAfter !== null && (
              <> {usedAfter} of {billing.max_inboxes} accounts used after this.</>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
