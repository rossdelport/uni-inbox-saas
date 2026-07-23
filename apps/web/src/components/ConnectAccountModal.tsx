import { useEffect, useState, type FormEvent } from "react";
import type { AccountInput, ProviderPreset, TestResult } from "../lib/types.js";
import { api } from "../lib/api.js";
import { useConnectAccount, useTestConnection } from "../lib/queries.js";

interface Preset {
  id: ProviderPreset;
  label: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "tls" | "starttls";
}

// Connect-an-inbox flow: pick a provider, fill credentials, test, save.
// Presets prefill hosts; every field stays editable for odd setups.
export function ConnectAccountModal({ onClose }: { onClose: () => void }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [preset, setPreset] = useState<Preset | null>(null);
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
    void api<Preset[]>("/api/accounts/presets").then(setPresets).catch(() => setPresets([]));
  }, []);

  function pickPreset(p: Preset) {
    setPreset(p);
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

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card-lg max-h-[90vh] w-full max-w-lg overflow-y-auto p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight">Connect an inbox</h2>
          <button
            className="grid h-8 w-8 place-items-center rounded-full transition hover:bg-[#f5f5f5]"
            style={{ color: "var(--ink-45)" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {!preset ? (
          <div className="grid gap-3">
            {presets.map((p) => (
              <button
                key={p.id}
                className="group flex items-center gap-3 rounded-3xl border px-5 py-4 text-left transition hover:scale-[1.01]"
                style={{ borderColor: "var(--ink-10)", boxShadow: "var(--shadow-card)" }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--blue-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--ink-10)")}
                onClick={() => pickPreset(p)}
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-lg"
                  style={{ background: "var(--blue-100)" }}
                >
                  {p.id === "gmail" ? "📮" : p.id === "porkbun" ? "🐷" : "✉️"}
                </span>
                <span>
                  <span className="font-ui block text-sm font-bold">{p.label}</span>
                  <span className="mt-0.5 block text-xs" style={{ color: "var(--ink-50)" }}>
                    {p.id === "gmail"
                      ? "Uses an app password (2 step verification required)"
                      : p.id === "porkbun"
                        ? "Porkbun hosted email on your own domain"
                        : "Any provider with IMAP and SMTP"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <button
              type="button"
              className="text-xs text-zinc-400 hover:text-zinc-600"
              onClick={() => setPreset(null)}
            >
              ← Different provider
            </button>

            {preset.id === "gmail" && (
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-[13px] leading-relaxed text-blue-800">
                Gmail needs an app password: turn on 2-step verification, then create one at{" "}
                <a
                  className="underline"
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noreferrer"
                >
                  myaccount.google.com/apppasswords
                </a>
                . Use it below instead of your normal password.
              </div>
            )}
            {preset.id === "porkbun" && (
              <div className="rounded-lg bg-blue-50 px-3 py-2 text-[13px] leading-relaxed text-blue-800">
                Use the full mailbox address and its password. If connecting fails, check the
                exact hosts in your Porkbun dashboard under Email Hosting, they can vary.
              </div>
            )}

            <div>
              <label className="label">Email address</label>
              <input
                className="input"
                type="email"
                required
                value={form.email_address}
                onChange={(e) => set("email_address", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Label (how it shows in your sidebar)</label>
              <input
                className="input"
                required
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder="e.g. Solar Cleaning"
              />
            </div>
            <div>
              <label className="label">
                {preset.id === "gmail" ? "App password" : "Password"}
              </label>
              <input
                className="input"
                type="password"
                required
                autoComplete="off"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </div>

            <details className="rounded-lg border border-zinc-200 px-3 py-2" open={preset.id === "custom"}>
              <summary className="cursor-pointer text-sm text-zinc-600">Server settings</summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Username</label>
                  <input
                    className="input"
                    required
                    value={form.imap_username}
                    onChange={(e) => set("imap_username", e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">IMAP host</label>
                  <input
                    className="input"
                    required
                    value={form.imap_host}
                    onChange={(e) => set("imap_host", e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">IMAP port</label>
                  <input
                    className="input"
                    type="number"
                    required
                    value={form.imap_port}
                    onChange={(e) => set("imap_port", Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label">SMTP host</label>
                  <input
                    className="input"
                    required
                    value={form.smtp_host}
                    onChange={(e) => set("smtp_host", e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">SMTP port</label>
                  <input
                    className="input"
                    type="number"
                    required
                    value={form.smtp_port}
                    onChange={(e) => set("smtp_port", Number(e.target.value))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="label">SMTP security</label>
                  <select
                    className="input"
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
              <div className="flex items-center gap-4 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
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

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                disabled={testMutation.isPending}
                onClick={() => void runTest()}
              >
                {testMutation.isPending ? "Testing…" : "Test connection"}
              </button>
              <button
                type="submit"
                className="btn"
                disabled={connect.isPending || testMutation.isPending}
              >
                {connect.isPending ? "Connecting…" : "Connect inbox"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
