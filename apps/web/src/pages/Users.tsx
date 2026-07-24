import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

// Founder dashboard: every user, plan, MRR, cash collected, join date and
// which landing-page button sent them. Owner email + admin password gated
// server-side; the password is remembered for the session only.

interface AdminUser {
  email: string;
  joined_at: string;
  plan: "trial" | "monthly" | "lifetime";
  plan_label: string;
  mrr_usd: number;
  trial_ends_at: string | null;
  subscription_status: string | null;
  signup_source: string | null;
}

interface AdminData {
  totals: {
    users: number;
    paying_monthly: number;
    lifetime: number;
    trials_active: number;
    mrr_usd: number;
    cash_collected_usd: number | null;
    refunded_usd: number | null;
  };
  users: AdminUser[];
}

const PW_KEY = "oi-admin-pw";

export function Users() {
  const [pw, setPw] = useState<string>(() => sessionStorage.getItem(PW_KEY) ?? "");
  const [entry, setEntry] = useState("");

  const query = useQuery({
    queryKey: ["admin-users", pw],
    enabled: pw.length > 0,
    retry: false,
    refetchInterval: 60_000,
    queryFn: () =>
      api<AdminData>("/api/admin/users", { headers: { "X-Admin-Password": pw } }),
  });

  function submitPw(e: FormEvent) {
    e.preventDefault();
    sessionStorage.setItem(PW_KEY, entry);
    setPw(entry);
  }

  if (!pw || (query.error && /password/i.test((query.error as Error).message))) {
    return (
      <div className="set-content" style={{ flex: 1 }}>
        <div className="set-pane active">
          <h1>Users</h1>
          <p className="p-sub">This page is for the founder. Enter the admin password.</p>
          <form className="set-card" onSubmit={submitPw} style={{ maxWidth: 380 }}>
            <div className="field">
              <label>Admin password</label>
              <input
                type="password"
                autoFocus
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
              />
            </div>
            {pw && query.error && <p className="err">Wrong password.</p>}
            <div style={{ marginTop: 16 }}>
              <button
                type="submit"
                className="btn-black"
                style={{ width: "auto", padding: "0 26px", height: 42, fontSize: 14 }}
                disabled={!entry}
              >
                Unlock
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const d = query.data;
  const money = (n: number | null | undefined) =>
    n === null || n === undefined ? "n/a" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

  return (
    <div className="set-content" style={{ flex: 1 }}>
      <div className="set-pane active">
        <h1>Users</h1>
        <p className="p-sub">
          {d ? `${d.totals.users} signups. Refreshes every minute.` : "Loading…"}
        </p>

        {query.error && !/password/i.test((query.error as Error).message) && (
          <p className="err">{(query.error as Error).message}</p>
        )}

        {d && (
          <>
            <div className="adm-tiles">
              <div className="adm-tile">
                <div className="t-num">{money(d.totals.mrr_usd)}</div>
                <div className="t-lab">MRR</div>
              </div>
              <div className="adm-tile">
                <div className="t-num">{money(d.totals.cash_collected_usd)}</div>
                <div className="t-lab">
                  Cash collected
                  {d.totals.refunded_usd ? ` (${money(d.totals.refunded_usd)} refunded)` : ""}
                </div>
              </div>
              <div className="adm-tile">
                <div className="t-num">{d.totals.paying_monthly + d.totals.lifetime}</div>
                <div className="t-lab">
                  Paying ({d.totals.paying_monthly} monthly, {d.totals.lifetime} lifetime)
                </div>
              </div>
              <div className="adm-tile">
                <div className="t-num">{d.totals.trials_active}</div>
                <div className="t-lab">Active trials</div>
              </div>
            </div>

            <div className="set-card" style={{ overflowX: "auto", padding: 0 }}>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Plan</th>
                    <th>MRR</th>
                    <th>Joined</th>
                    <th>Trial ends</th>
                    <th>Signed up via</th>
                  </tr>
                </thead>
                <tbody>
                  {d.users.map((u) => (
                    <tr key={u.email}>
                      <td>{u.email}</td>
                      <td>
                        <span className={`adm-plan ${u.plan}`}>{u.plan_label}</span>
                      </td>
                      <td>{u.mrr_usd ? money(u.mrr_usd) : "·"}</td>
                      <td>{when(u.joined_at)}</td>
                      <td>{u.plan === "trial" ? when(u.trial_ends_at) : "·"}</td>
                      <td className="adm-src">{u.signup_source ?? "direct"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
