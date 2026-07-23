import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase.js";
import { useAccounts, useBillingState, useInbox } from "../lib/queries.js";
import { PlansModal } from "./PlansModal.js";
import { ConnectAccountModal } from "./ConnectAccountModal.js";

export interface AppOutletContext {
  search: string;
}

// App chrome: white top bar (logo, global search, avatar menu) and a flat
// white sidebar (views, accounts with unread counts, add account, plan promo).
export function Layout() {
  const { data: accounts } = useAccounts();
  const { data: billing } = useBillingState();
  const inbox = useInbox(null, false);
  const [params] = useSearchParams();
  const activeAccount = params.get("account");
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // Close the avatar menu on any outside click.
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

  const sidebar = (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-zinc-100 bg-white">
      <nav className="flex-1 overflow-y-auto px-4 py-4">
        <button className="btn-dark mb-4 w-full" onClick={() => { setMobileNav(false); navigate("/compose"); }}>
          ✏️ New message
        </button>

        <NavLink
          to="/"
          end
          onClick={() => setMobileNav(false)}
          className={({ isActive }) => `side-item ${isActive && !activeAccount ? "active" : ""}`}
        >
          <InboxIcon />
          All inboxes
          {totalUnread > 0 && <span className="count-pill">{totalUnread}</span>}
        </NavLink>
        <NavLink
          to="/archived"
          onClick={() => setMobileNav(false)}
          className={({ isActive }) => `side-item mt-0.5 ${isActive ? "active" : ""}`}
        >
          <ArchiveIcon />
          Archived
        </NavLink>

        <div className="mt-6">
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
            Accounts
          </div>
          {(accounts ?? []).map((a) => {
            const unread = unreadByAccount.get(a.id) ?? 0;
            return (
              <NavLink
                key={a.id}
                to={`/?account=${a.id}`}
                onClick={() => setMobileNav(false)}
                className={`side-item mt-0.5 ${activeAccount === a.id ? "active" : ""}`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: a.color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-zinc-800">
                    {a.label}
                  </span>
                  <span className="block truncate text-[12px] font-normal text-zinc-400">
                    {a.email_address}
                  </span>
                </span>
                {a.status !== "active" ? (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-red-500"
                    title={a.status === "auth_failed" ? "Sign in failed" : "Paused"}
                  />
                ) : (
                  unread > 0 && <span className="count-pill">{unread}</span>
                )}
              </NavLink>
            );
          })}

          <button
            className="mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-[#9ec5f8] px-3 py-2.5 text-[14px] font-medium text-[#1c7ef7] transition hover:bg-[#f2f7ff]"
            onClick={() => {
              setMobileNav(false);
              setConnectOpen(true);
            }}
          >
            <span className="grid h-5 w-5 place-items-center rounded-full border border-[#9ec5f8] text-[13px]">
              +
            </span>
            Add account
          </button>
        </div>
      </nav>

      {/* Plan promo card, pinned to the bottom like the mock */}
      <div className="px-4 pb-4">
        {billing?.plan === "trial" ? (
          <div className="rounded-2xl p-4 text-white" style={{ background: "#1c7ef7" }}>
            <div className="text-[15px] font-bold">
              {billing.trial_expired ? "Trial ended" : "Free trial"}
            </div>
            <p className="mt-1 text-[13px] leading-snug text-white/85">
              {billing.trial_expired
                ? "Pick a plan to keep your inboxes syncing."
                : `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left. Up to 12 accounts on a plan, one clean inbox.`}
            </p>
            <button
              className="mt-3 w-full rounded-full bg-black py-2 text-[14px] font-semibold text-white transition hover:opacity-90"
              onClick={() => setPlansOpen(true)}
            >
              See plans
            </button>
          </div>
        ) : billing ? (
          <button
            className="w-full rounded-2xl bg-zinc-50 px-4 py-3 text-left transition hover:bg-zinc-100"
            onClick={() => setPlansOpen(true)}
          >
            <span className="block text-[13px] font-semibold text-zinc-800">
              {billing.plan_label} plan
            </span>
            <span className="block text-[12px] text-zinc-400">
              {billing.connected_inboxes} of {billing.max_inboxes} accounts used
            </span>
          </button>
        ) : null}
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Top bar */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-100 bg-white px-4 sm:px-6">
        <button
          className="grid h-9 w-9 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 md:hidden"
          onClick={() => setMobileNav(true)}
          aria-label="Open menu"
        >
          ☰
        </button>
        <NavLink to="/" className="flex items-center gap-2">
          <span
            className="grid h-8 w-8 place-items-center rounded-[9px]"
            style={{ background: "linear-gradient(180deg, #4da3ff 0%, #1c7ef7 100%)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M3 9.5 12 4l9 5.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19V9.5Z" fill="#fff" />
              <path d="M3 9.5 12 15l9-5.5" stroke="#1c7ef7" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="hidden text-[17px] font-bold tracking-tight text-zinc-900 sm:block">
            uni-inbox
          </span>
        </NavLink>

        <div className="mx-auto w-full max-w-xl">
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search every inbox at once..."
              className="w-full rounded-full border border-transparent bg-[#f1f5f9] py-2.5 pl-10 pr-4 text-[14px] text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-[#1c7ef7] focus:bg-white"
            />
          </div>
        </div>

        {/* Avatar + dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            className="grid h-10 w-10 place-items-center rounded-full text-[15px] font-bold text-white transition hover:opacity-90"
            style={{ background: "#1c7ef7" }}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {initial}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-12 z-50 w-72 rounded-3xl bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.18)] ring-1 ring-zinc-100">
              <div className="px-3 pb-3 pt-2">
                <div className="text-[17px] font-bold text-zinc-900">{displayName}</div>
                <div className="mt-0.5 truncate text-[14px] text-zinc-400">{user?.email}</div>
              </div>
              <div className="border-t border-zinc-100 py-2">
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/settings");
                  }}
                >
                  <GearIcon /> Settings
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setPlansOpen(true);
                  }}
                >
                  <StarIcon /> Plans &amp; billing
                </button>
                <a className="menu-item" href="/contacts" onClick={() => setMenuOpen(false)}>
                  <HelpIcon /> Help &amp; support
                </a>
              </div>
              <div className="border-t border-zinc-100 pt-2">
                <button
                  className="menu-item"
                  style={{ color: "#e11d48" }}
                  onClick={() => void supabase.auth.signOut()}
                >
                  <LogoutIcon /> Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden md:block">{sidebar}</div>
        {mobileNav && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileNav(false)}>
            <div className="absolute inset-0 bg-zinc-900/30" />
            <div className="absolute inset-y-0 left-0" onClick={(e) => e.stopPropagation()}>
              {sidebar}
            </div>
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto bg-white">
          <Outlet context={{ search } satisfies AppOutletContext} />
        </main>
      </div>

      {plansOpen && <PlansModal onClose={() => setPlansOpen(false)} />}
      {connectOpen && <ConnectAccountModal onClose={() => setConnectOpen(false)} />}
    </div>
  );
}

function InboxIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 13h4l2 3h6l2-3h4" strokeLinejoin="round" />
      <path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" strokeLinejoin="round" />
    </svg>
  );
}
function ArchiveIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" strokeLinecap="round" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.09a1.6 1.6 0 0 0-1-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.09a1.6 1.6 0 0 0 1.47-1 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32h.01a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.09a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77v.01a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.09a1.6 1.6 0 0 0-1.47 1Z" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3Z" strokeLinejoin="round" />
    </svg>
  );
}
function HelpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.9.7c0 1.6-2.4 2.1-2.4 3.3M12 17h.01" strokeLinecap="round" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
