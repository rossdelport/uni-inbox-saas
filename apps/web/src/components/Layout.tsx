import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase.js";
import { useAccounts, useBillingState, useInbox } from "../lib/queries.js";
import { LOGO_SRC } from "../lib/assets.js";
import { PlansModal } from "./PlansModal.js";
import { ConnectAccountModal } from "./ConnectAccountModal.js";

export interface AppOutletContext {
  search: string;
}

// App chrome in the uni-ui kit: .dash-top bar (logo, search, avatar menu) and
// the .dash-side sidebar (views, accounts, add account, plan upsell card).
export function Layout() {
  const { data: accounts } = useAccounts();
  const { data: billing } = useBillingState();
  const inbox = useInbox({});
  const [params] = useSearchParams();
  const activeAccount = params.get("account");
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // Toast bus: any component fires toast("...") and it shows here.
  useEffect(() => {
    function onToast(e: Event) {
      setToastMsg((e as CustomEvent<string>).detail);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
    }
    document.addEventListener("uni:toast", onToast);
    return () => document.removeEventListener("uni:toast", onToast);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const threads = inbox.data?.pages.flatMap((p) => p.threads) ?? [];
  const totalUnread = threads.filter((t) => t.unread).length;
  const unreadByAccount = new Map<string, number>();
  for (const t of threads) {
    if (t.unread) unreadByAccount.set(t.account_id, (unreadByAccount.get(t.account_id) ?? 0) + 1);
  }

  const displayName =
    (user?.user_metadata?.full_name as string | undefined) || user?.email?.split("@")[0] || "You";
  const initial = displayName.charAt(0).toUpperCase();

  const trialDaysLeft = billing?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(billing.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : null;

  function go(path: string) {
    setDrawer(false);
    navigate(path);
  }

  return (
    <div className="dash">
      <header className="dash-top">
        <button className="dash-burger" aria-label="Menu" onClick={() => setDrawer((d) => !d)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <a className="logo-lock" href="/">
          <img src={LOGO_SRC} alt="Uni-Inbox logo" />
          <span>uni-inbox</span>
        </a>
        <div className="dash-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="text"
            placeholder="Search every inbox at once..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="dd-wrap" style={{ marginLeft: "auto" }} ref={menuRef}>
          <div className="dash-avatar" onClick={() => setMenuOpen((o) => !o)}>
            {initial}
          </div>
          <div className={`uni-dd ${menuOpen ? "open" : ""}`}>
            <div className="dd-head">
              <div className="n">{displayName}</div>
              <div className="e">{user?.email}</div>
            </div>
            <button
              onClick={() => {
                setMenuOpen(false);
                navigate("/settings");
              }}
            >
              <GearIcon /> Settings
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                setPlansOpen(true);
              }}
            >
              <StarIcon /> Plans &amp; billing
            </button>
            <a href="/contacts/" onClick={() => setMenuOpen(false)}>
              <HelpIcon /> Help &amp; support
            </a>
            <div className="dd-sep" />
            <button style={{ color: "#EA4335" }} onClick={() => void supabase.auth.signOut()}>
              <LogoutIcon /> Log out
            </button>
          </div>
        </div>
      </header>

      <div className="dash-main">
        <aside className={`dash-side ${drawer ? "open" : ""}`}>
          <SideLink to="/" label="All inboxes" active={!activeAccount} count={totalUnread} onGo={go}>
            <InboxIcon />
          </SideLink>
          <SideLink to="/starred" label="Starred" onGo={go}>
            <StarIcon />
          </SideLink>
          <SideLink to="/later" label="Read later" onGo={go}>
            <ClockIcon />
          </SideLink>
          <SideLink to="/archived" label="Archived" onGo={go}>
            <ArchiveIcon />
          </SideLink>

          <div className="side-head">Accounts</div>
          <div>
            {(accounts ?? []).map((a) => {
              const unread = unreadByAccount.get(a.id) ?? 0;
              return (
                <button
                  key={a.id}
                  className={`side-item ${activeAccount === a.id ? "active" : ""}`}
                  onClick={() => go(`/?account=${a.id}`)}
                >
                  <i className="side-dot" style={{ background: a.color }} />
                  <span style={{ minWidth: 0 }}>
                    {a.label}
                    <span className="email">{a.email_address}</span>
                  </span>
                  {a.status !== "active" ? (
                    <span
                      className="cnt"
                      style={{ background: "#fde8e6", color: "#EA4335" }}
                      title={a.status === "auth_failed" ? "Sign in failed" : "Paused"}
                    >
                      !
                    </span>
                  ) : unread > 0 ? (
                    <span className="cnt">{unread}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <button
            className="side-item side-add"
            onClick={() => {
              setDrawer(false);
              setConnectOpen(true);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            Add account
          </button>

          <div className="side-upsell">
            {billing?.plan === "trial" ? (
              <>
                <h4>{billing.trial_expired ? "Trial ended" : "Free trial"}</h4>
                <p>
                  {billing.trial_expired
                    ? "Pick a plan to keep every inbox syncing."
                    : `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left. Up to 12 accounts on a plan, one clean inbox.`}
                </p>
              </>
            ) : (
              <>
                <h4>{billing ? `${billing.plan_label} plan` : "Your plan"}</h4>
                <p>
                  {billing
                    ? `${billing.connected_inboxes} of ${billing.max_inboxes} accounts used. Every future update included.`
                    : ""}
                </p>
              </>
            )}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setDrawer(false);
                setPlansOpen(true);
              }}
            >
              See plans
            </a>
          </div>
        </aside>

        <div className={`side-scrim ${drawer ? "show" : ""}`} onClick={() => setDrawer(false)} />

        <Outlet context={{ search } satisfies AppOutletContext} />
      </div>

      {plansOpen && <PlansModal onClose={() => setPlansOpen(false)} />}
      {connectOpen && <ConnectAccountModal onClose={() => setConnectOpen(false)} />}
      <div className={`uni-toast ${toastMsg ? "show" : ""}`}>{toastMsg}</div>
    </div>
  );
}

function SideLink({
  to,
  label,
  count,
  active,
  onGo,
  children,
}: {
  to: string;
  label: string;
  count?: number;
  active?: boolean;
  onGo: (path: string) => void;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={(e) => {
        e.preventDefault();
        onGo(to);
      }}
      className={({ isActive }) =>
        `side-item ${(active !== undefined ? active && isActive : isActive) ? "active" : ""}`
      }
    >
      {children}
      {label}
      {count !== undefined && count > 0 && <span className="cnt">{count}</span>}
    </NavLink>
  );
}

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} width="16" height="16">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}
function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} width="16" height="16">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} width="16" height="16">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#EA4335" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
