import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { PasswordInput } from "../components/PasswordInput.js";

// This is deliberately a separate founder screen rather than a customer
// feature. The API repeats both checks — owner email and admin password — so
// hiding this route in the menu is only a convenience, never the protection.
interface WaitlistSignup {
  id: string;
  email: string;
  source: string | null;
  page_path: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  promo_code: string | null;
  email_sent_at: string | null;
  created_at: string;
  feedback: string | null;
  feedback_at: string | null;
}

interface WaitlistData {
  totals: {
    landing_views: number;
    waitlist_signups: number;
    conversion_percent: number;
    views_7d: number;
    views_30d: number;
    signups_7d: number;
    feedback_count: number;
  };
  traffic: {
    by_day: Array<{ day: string; views: number }>;
    top_referrers: Array<{ key: string; views: number }>;
    truncated: boolean;
  };
  sources: Array<{ source: string; signups: number }>;
  signups: WaitlistSignup[];
  table_truncated: boolean;
}

const PW_KEY = "oi-admin-pw";
const CTA_LABELS: Record<string, string> = {
  hero: "Hero",
  nav: "Navigation",
  features: "Features",
  solutions: "Solutions",
  pricing: "Pricing",
  "final-cta": "Final call to action",
  unknown: "Unknown",
};

function ctaLabel(source: string | null): string {
  const raw = source?.trim().toLowerCase() || "unknown";
  return CTA_LABELS[raw] ?? raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function referrerLabel(referrer: string | null): string {
  if (!referrer) return "Direct";
  if (referrer.startsWith("campaign:")) return referrer.slice("campaign:".length) || "Campaign";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return referrer.slice(0, 42);
  }
}

export function Waitlist() {
  const [pw, setPw] = useState<string>(() => sessionStorage.getItem(PW_KEY) ?? "");
  const [entry, setEntry] = useState("");
  const [source, setSource] = useState("all");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["admin-waitlist", pw],
    enabled: pw.length > 0,
    retry: false,
    refetchInterval: 30_000,
    queryFn: () => api<WaitlistData>("/api/admin/waitlist", { headers: { "X-Admin-Password": pw } }),
  });

  function submitPw(event: FormEvent) {
    event.preventDefault();
    sessionStorage.setItem(PW_KEY, entry);
    setPw(entry);
  }

  const data = query.data;
  const sourceOptions = useMemo(() => ["all", ...(data?.sources ?? []).map((row) => row.source)], [data]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.signups ?? []).filter((signup) => {
      const sourceMatch = source === "all" || (signup.source?.trim() || "unknown") === source;
      if (!sourceMatch) return false;
      if (!needle) return true;
      return [signup.email, signup.source, signup.utm_campaign, signup.referrer, signup.feedback]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [data, search, source]);

  if (!pw || (query.error && /password/i.test((query.error as Error).message))) {
    return (
      <div className="set-content" style={{ flex: 1 }}>
        <div className="set-pane active">
          <h1>Waitlist</h1>
          <p className="p-sub">Founder-only waitlist and landing-page analytics.</p>
          <form className="set-card" onSubmit={submitPw} style={{ maxWidth: 380 }}>
            <div className="field">
              <label>Admin password</label>
              <PasswordInput autoFocus value={entry} onChange={(event) => setEntry(event.target.value)} />
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

  const sparkMax = Math.max(1, ...(data?.traffic.by_day ?? []).map((point) => point.views));
  const conversion = `${data?.totals.conversion_percent.toFixed(1) ?? "0.0"}%`;

  async function copyEmails() {
    const emails = rows.map((signup) => signup.email).join(", ");
    if (!emails) return;
    try {
      await navigator.clipboard.writeText(emails);
      toast(`${rows.length} waitlist email${rows.length === 1 ? "" : "s"} copied.`, "success");
    } catch {
      toast("Could not copy the emails. Select them from the table instead.", "warn");
    }
  }

  return (
    <div className="set-content" style={{ flex: 1 }}>
      <div className="set-pane active">
        <h1>Waitlist</h1>
        <p className="p-sub">
          {data
            ? `${data.totals.waitlist_signups} people are waiting. Refreshes every 30 seconds.`
            : "Loading waitlist data…"}
        </p>

        {query.error && !/password/i.test((query.error as Error).message) && (
          <p className="err">{(query.error as Error).message}</p>
        )}

        {data && (
          <>
            <div className="adm-tiles wait-tiles">
              <div className="adm-tile">
                <div className="t-num">{data.totals.landing_views.toLocaleString()}</div>
                <div className="t-lab">Landing-page views</div>
              </div>
              <div className="adm-tile">
                <div className="t-num">{data.totals.waitlist_signups.toLocaleString()}</div>
                <div className="t-lab">Joined the waitlist</div>
              </div>
              <div className="adm-tile">
                <div className="t-num">{conversion}</div>
                <div className="t-lab">View-to-waitlist conversion</div>
              </div>
              <div className="adm-tile">
                <div className="t-num">{data.totals.signups_7d.toLocaleString()}</div>
                <div className="t-lab">New sign-ups this week</div>
              </div>
              <div className="adm-tile">
                <div className="t-num">{data.totals.feedback_count.toLocaleString()}</div>
                <div className="t-lab">“What made you sign up?” replies</div>
              </div>
            </div>

            <p className="wait-note">
              Landing-page views are cookie-free page loads. A person refreshing the page counts more than once, so the
              conversion number is intentionally conservative rather than pretending to be a unique-visitor estimate.
            </p>

            <div className="adm-sec adm-grid2">
              <div className="set-card">
                <div className="adm-sec-head">
                  <h2>Landing-page traffic</h2>
                  <span>
                    {data.totals.views_7d} this week · {data.totals.views_30d} in 30 days
                    {data.traffic.truncated ? " (capped)" : ""}
                  </span>
                </div>
                {data.totals.views_30d === 0 ? (
                  <p className="adm-empty">No page loads have been recorded yet.</p>
                ) : (
                  <div className="adm-spark" aria-label="Landing page views over the last 30 days">
                    {data.traffic.by_day.map((point) => (
                      <i
                        key={point.day}
                        className={point.views === sparkMax ? "hot" : undefined}
                        style={{ height: `${Math.max(3, (point.views / sparkMax) * 100)}%` }}
                        title={`${point.day}: ${point.views} view${point.views === 1 ? "" : "s"}`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="set-card">
                <div className="adm-sec-head">
                  <h2>Where sign-ups clicked</h2>
                  <span>CTA source</span>
                </div>
                {data.sources.length === 0 ? (
                  <p className="adm-empty">CTA attribution will appear with the first sign-up.</p>
                ) : (
                  <div className="adm-rank">
                    {data.sources.map((row) => (
                      <div className="adm-rank-row" key={row.source}>
                        <b>{ctaLabel(row.source)}</b>
                        <span>{row.signups}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="adm-sec adm-grid2">
              <div className="set-card">
                <div className="adm-sec-head">
                  <h2>Top referrers</h2>
                  <span>landing-page traffic</span>
                </div>
                {data.traffic.top_referrers.length === 0 ? (
                  <p className="adm-empty">No outside referrers recorded yet.</p>
                ) : (
                  <div className="adm-rank">
                    {data.traffic.top_referrers.map((row) => (
                      <div className="adm-rank-row" key={row.key}>
                        <b>{row.key}</b>
                        <span>{row.views}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="set-card wait-insight">
                <div className="adm-sec-head">
                  <h2>Launch signal</h2>
                  <span>what to watch</span>
                </div>
                <p>
                  {data.totals.waitlist_signups === 0
                    ? "Your first ad clicks will appear in Landing-page traffic. A submitted email then moves the conversion number above zero."
                    : `${data.totals.waitlist_signups} people have raised their hand. The CTA-source list shows which placement is earning those sign-ups.`}
                </p>
              </div>
            </div>

            <div className="adm-sec">
              <div className="adm-sec-head">
                <h2>People on the waitlist</h2>
                <span>
                  {rows.length} shown{data.table_truncated ? " · latest 1,000 only" : ""}
                </span>
              </div>
              <div className="wait-controls">
                <input
                  type="search"
                  aria-label="Search waitlist"
                  placeholder="Search email, campaign or feedback…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <select aria-label="Filter waitlist by CTA source" value={source} onChange={(event) => setSource(event.target.value)}>
                  {sourceOptions.map((option) => (
                    <option value={option} key={option}>
                      {option === "all" ? "All CTA sources" : ctaLabel(option)}
                    </option>
                  ))}
                </select>
                <button className="btn-mini" onClick={() => void copyEmails()} disabled={rows.length === 0}>
                  Copy emails
                </button>
              </div>

              <div className="set-card" style={{ overflowX: "auto", padding: 0, marginTop: 12 }}>
                <table className="adm-table wait-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Joined</th>
                      <th>Clicked</th>
                      <th>Campaign / referrer</th>
                      <th>First month</th>
                      <th>What made them sign up?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((signup) => {
                      const campaign = signup.utm_campaign || signup.utm_source || null;
                      return (
                        <tr key={signup.id}>
                          <td>{signup.email}</td>
                          <td>{when(signup.created_at)}</td>
                          <td>
                            <span className="wait-source">{ctaLabel(signup.source)}</span>
                          </td>
                          <td>
                            {campaign && <div>{campaign}</div>}
                            <div className="adm-src">{referrerLabel(signup.referrer)}</div>
                          </td>
                          <td>
                            {signup.promo_code ? (
                              <code className="wait-code">{signup.promo_code}</code>
                            ) : (
                              <span className="adm-dim">—</span>
                            )}
                          </td>
                          <td className="wait-feedback">
                            {signup.feedback ? (
                              <span title={signup.feedback}>{signup.feedback}</span>
                            ) : (
                              <span className="adm-dim">No reply yet</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="adm-dim" style={{ padding: 18 }}>
                          No waitlist sign-ups match this filter yet.
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
