import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { PasswordInput } from "../components/PasswordInput.js";

// Founder analytics. Built around one question, because it is the only one the
// numbers currently have a bad answer to: of the people who sign up, how many
// connect a mailbox? Everything here either answers that or gives something to
// act on (a stalled signup to email, a broken mailbox to fix, a trial about to
// lapse). Owner email + admin password gated server-side; the password is
// remembered for the session only.

type Stage = "signed_up" | "activated" | "paying";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  joined_at: string;
  confirmed: boolean;
  last_sign_in_at: string | null;
  days_idle: number | null;
  plan: "trial" | "monthly" | "lifetime";
  plan_label: string;
  mrr_usd: number;
  trial_ends_at: string | null;
  trial_days_left: number | null;
  subscription_status: string | null;
  signup_source: string | null;
  accounts: number;
  accounts_broken: number;
  providers: string[];
  threads: number;
  unread: number;
  messages: number;
  last_mail_at: string | null;
  stage: Stage;
}

interface AdminData {
  totals: {
    users: number;
    activated: number;
    paying: number;
    paying_monthly: number;
    lifetime: number;
    trials_active: number;
    trials_expiring_soon: number;
    mrr_usd: number;
    cash_collected_usd: number | null;
    refunded_usd: number | null;
    accounts_total: number;
    accounts_broken: number;
    messages_total: number;
  };
  funnel: Array<{ stage: string; n: number }>;
  traffic: {
    views_7d: number;
    views_30d: number;
    by_day: Array<{ day: string; views: number }>;
    top_paths: Array<{ key: string; views: number }>;
    top_referrers: Array<{ key: string; views: number }>;
    truncated: boolean;
  };
  attention: Array<{
    user_email: string;
    account_email: string;
    provider: string;
    status: string;
    consecutive_failures: number;
    last_error: string | null;
  }>;
  users: AdminUser[];
}

const PW_KEY = "oi-admin-pw";
const STAGE_LABEL: Record<Stage, string> = {
  signed_up: "No mailbox",
  activated: "Activated",
  paying: "Paying",
};

export function Users() {
  const [pw, setPw] = useState<string>(() => sessionStorage.getItem(PW_KEY) ?? "");
  const [entry, setEntry] = useState("");
  const [filter, setFilter] = useState<"all" | Stage>("all");

  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (u: { id: string; email: string }) =>
      api(`/api/admin/users/${u.id}`, { method: "DELETE", headers: { "X-Admin-Password": pw } }),
    onSuccess: (_d, u) => toast(`${u.email} deleted.`, "success"),
    onError: (err) => toast((err as Error).message, "warn"),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const query = useQuery({
    queryKey: ["admin-users", pw],
    enabled: pw.length > 0,
    retry: false,
    refetchInterval: 60_000,
    queryFn: () => api<AdminData>("/api/admin/users", { headers: { "X-Admin-Password": pw } }),
  });

  function submitPw(e: FormEvent) {
    e.preventDefault();
    sessionStorage.setItem(PW_KEY, entry);
    setPw(entry);
  }

  const d = query.data;
  const stalled = useMemo(
    () => (d?.users ?? []).filter((u) => u.stage === "signed_up"),
    [d],
  );
  const shown = useMemo(
    () => (d?.users ?? []).filter((u) => filter === "all" || u.stage === filter),
    [d, filter],
  );

  if (!pw || (query.error && /password/i.test((query.error as Error).message))) {
    return (
      <div className="set-content" style={{ flex: 1 }}>
        <div className="set-pane active">
          <h1>Analytics</h1>
          <p className="p-sub">This page is for the founder. Enter the admin password.</p>
          <form className="set-card" onSubmit={submitPw} style={{ maxWidth: 380 }}>
            <div className="field">
              <label>Admin password</label>
              <PasswordInput autoFocus value={entry} onChange={(e) => setEntry(e.target.value)} />
            </div>
            {pw && query.error && <p className="err">Wrong password.</p>}
            <div style={{ marginTop: 16 }}>
              <button type="submit" className="btn-black btn-auto" disabled={!entry}>
                Unlock
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const money = (n: number | null | undefined) =>
    n === null || n === undefined ? "n/a" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "·";
  const ago = (days: number | null) =>
    days === null ? "never" : days === 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;
  const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "·");

  const funnelMax = Math.max(1, ...(d?.funnel ?? []).map((f) => f.n));
  const sparkMax = Math.max(1, ...(d?.traffic.by_day ?? []).map((p) => p.views));

  async function copyStalled() {
    const list = stalled.map((u) => u.email).join(", ");
    try {
      await navigator.clipboard.writeText(list);
      toast(`${stalled.length} email${stalled.length === 1 ? "" : "s"} copied.`, "success");
    } catch {
      toast("Could not copy. Select the emails in the table instead.", "warn");
    }
  }

  return (
    <div className="set-content" style={{ flex: 1 }}>
      <div className="set-pane active">
        <h1>Analytics</h1>
        <p className="p-sub">
          {d
            ? `${d.totals.users} signups, ${d.totals.activated} activated, ${d.totals.paying} paying. Refreshes every minute.`
            : "Loading…"}
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
              {/* The number to move. Signups mean nothing until a mailbox is on. */}
              <div className="adm-tile">
                <div className="t-num">{pct(d.totals.activated, d.totals.users)}</div>
                <div className="t-lab">
                  Activation ({d.totals.activated}/{d.totals.users} connected a mailbox)
                </div>
              </div>
              <div className="adm-tile">
                <div className="t-num">{d.totals.paying}</div>
                <div className="t-lab">
                  Paying ({d.totals.paying_monthly} monthly, {d.totals.lifetime} lifetime)
                </div>
              </div>
              <div className="adm-tile">
                <div className="t-num">
                  {d.totals.trials_active}
                  {d.totals.trials_expiring_soon > 0 && (
                    <span style={{ fontSize: 13, color: "#b06000" }}> ({d.totals.trials_expiring_soon} ending)</span>
                  )}
                </div>
                <div className="t-lab">Active trials</div>
              </div>
              <div className="adm-tile">
                <div className="t-num">{d.totals.accounts_total}</div>
                <div className="t-lab">
                  Mailboxes connected
                  {d.totals.accounts_broken > 0 ? ` (${d.totals.accounts_broken} broken)` : ""}
                </div>
              </div>
            </div>

            {/* Broken mailboxes first: this is silent churn. The customer just
                sees an inbox that stopped updating and blames the product. */}
            {d.attention.length > 0 && (
              <div className="adm-warn">
                <h3>
                  {d.attention.length} mailbox{d.attention.length === 1 ? "" : "es"} need attention
                </h3>
                <ul>
                  {d.attention.map((a, i) => (
                    <li key={i}>
                      <b>{a.account_email}</b> ({a.provider}) for {a.user_email} · {a.status}, {a.consecutive_failures}{" "}
                      failures{a.last_error ? ` · ` : ""}
                      {a.last_error && <code>{a.last_error.slice(0, 120)}</code>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="adm-sec adm-grid2">
              <div className="set-card">
                <div className="adm-sec-head">
                  <h2>Funnel</h2>
                  <span>last 30 days</span>
                </div>
                <div className="adm-funnel">
                  {d.funnel.map((f, i) => {
                    const prev = i > 0 ? d.funnel[i - 1] : undefined;
                    return (
                      <div className="adm-fun-row" key={f.stage}>
                        <div className="adm-fun-lab">{f.stage}</div>
                        <div className="adm-fun-track">
                          <div className="adm-fun-fill" style={{ width: `${(f.n / funnelMax) * 100}%` }} />
                        </div>
                        <div className="adm-fun-num adm-num">
                          {f.n}
                          {prev && prev.n > 0 && <i>{pct(f.n, prev.n)}</i>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="set-card">
                <div className="adm-sec-head">
                  <h2>Traffic</h2>
                  <span>
                    {d.traffic.views_7d} views this week · {d.traffic.views_30d} in 30 days
                    {d.traffic.truncated ? " (capped)" : ""}
                  </span>
                </div>
                {d.traffic.views_30d === 0 ? (
                  <p className="adm-empty">
                    No page views recorded yet. Views are counted server-side as pages are served, so this fills in
                    as soon as anyone loads the site.
                  </p>
                ) : (
                  <div className="adm-spark">
                    {d.traffic.by_day.map((p) => (
                      <i
                        key={p.day}
                        className={p.views === sparkMax ? "hot" : undefined}
                        style={{ height: `${Math.max(3, (p.views / sparkMax) * 100)}%` }}
                        title={`${p.day}: ${p.views} views`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="adm-sec adm-grid2">
              <div className="set-card">
                <div className="adm-sec-head">
                  <h2>Top pages</h2>
                </div>
                {d.traffic.top_paths.length === 0 ? (
                  <p className="adm-empty">Nothing yet.</p>
                ) : (
                  <div className="adm-rank">
                    {d.traffic.top_paths.map((p) => (
                      <div className="adm-rank-row" key={p.key}>
                        <b>{p.key}</b>
                        <span className="adm-num">{p.views}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="set-card">
                <div className="adm-sec-head">
                  <h2>Where they came from</h2>
                  <span>referrer or campaign</span>
                </div>
                {d.traffic.top_referrers.length === 0 ? (
                  <p className="adm-empty">
                    No referrers yet. Direct traffic and ad platforms that strip the referrer show up under their
                    campaign tag instead.
                  </p>
                ) : (
                  <div className="adm-rank">
                    {d.traffic.top_referrers.map((r) => (
                      <div className="adm-rank-row" key={r.key}>
                        <b>{r.key}</b>
                        <span className="adm-num">{r.views}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="adm-sec">
              <div className="adm-sec-head">
                <h2>People</h2>
                <span>
                  {shown.length} of {d.users.length} shown
                </span>
              </div>
              <div className="adm-actions">
                {(["all", "signed_up", "activated", "paying"] as const).map((f) => (
                  <button
                    key={f}
                    className="btn-mini"
                    style={
                      filter === f ? { borderColor: "var(--b1)", color: "var(--b1)" } : undefined
                    }
                    onClick={() => setFilter(f)}
                  >
                    {f === "all" ? "Everyone" : STAGE_LABEL[f]}
                    {f !== "all" && ` (${d.users.filter((u) => u.stage === f).length})`}
                  </button>
                ))}
                {stalled.length > 0 && (
                  <button className="btn-mini" onClick={() => void copyStalled()}>
                    Copy {stalled.length} stalled email{stalled.length === 1 ? "" : "s"}
                  </button>
                )}
              </div>

              <div className="set-card" style={{ overflowX: "auto", padding: 0, marginTop: 12 }}>
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Stage</th>
                      <th>Mailboxes</th>
                      <th>Mail</th>
                      <th>Plan</th>
                      <th>MRR</th>
                      <th>Joined</th>
                      <th>Last seen</th>
                      <th>Trial</th>
                      <th>Came from</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.email}
                          {u.name && <div className="adm-src">{u.name}</div>}
                          {!u.confirmed && <div className="adm-src">unconfirmed email</div>}
                        </td>
                        <td>
                          <span className={`adm-stage ${u.stage}`}>{STAGE_LABEL[u.stage]}</span>
                        </td>
                        <td className="adm-num">
                          {u.accounts === 0 ? (
                            <span className="adm-dim">none</span>
                          ) : (
                            <>
                              {u.accounts}
                              {u.accounts_broken > 0 && (
                                <span style={{ color: "#c5221f" }}> ({u.accounts_broken} broken)</span>
                              )}
                              {u.providers.length > 0 && <div className="adm-src">{u.providers.join(", ")}</div>}
                            </>
                          )}
                        </td>
                        <td className="adm-num">
                          {u.messages === 0 ? (
                            <span className="adm-dim">·</span>
                          ) : (
                            <>
                              {u.messages.toLocaleString()}
                              <div className="adm-src">
                                {u.threads.toLocaleString()} threads, {u.unread} unread
                              </div>
                            </>
                          )}
                        </td>
                        <td>
                          <span className={`adm-plan ${u.plan}`}>{u.plan_label}</span>
                        </td>
                        <td className="adm-num">{u.mrr_usd ? money(u.mrr_usd) : "·"}</td>
                        <td>{when(u.joined_at)}</td>
                        <td className={u.days_idle !== null && u.days_idle >= 7 ? "adm-dim" : undefined}>
                          {ago(u.days_idle)}
                        </td>
                        <td>
                          {u.plan !== "trial" ? (
                            <span className="adm-dim">·</span>
                          ) : u.trial_days_left === null ? (
                            <span className="adm-dim">·</span>
                          ) : u.trial_days_left < 0 ? (
                            <span style={{ color: "#c5221f" }}>ended</span>
                          ) : (
                            <span style={{ color: u.trial_days_left <= 2 ? "#b06000" : undefined }}>
                              {u.trial_days_left}d left
                            </span>
                          )}
                        </td>
                        <td className="adm-src">{u.signup_source ?? "direct"}</td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="btn-mini danger"
                            disabled={del.isPending}
                            onClick={() => {
                              // Server refuses the admin's own row; everything
                              // else is gone for good, mail and billing included.
                              if (
                                window.confirm(
                                  `Delete ${u.email} and ALL their data (accounts, mail, billing)? This cannot be undone.`,
                                )
                              )
                                del.mutate({ id: u.id, email: u.email });
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={11} className="adm-dim" style={{ padding: 18 }}>
                          Nobody in this group.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
