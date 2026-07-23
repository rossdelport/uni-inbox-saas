import { NavLink, Outlet, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { useAccounts, useBillingState } from "../lib/queries.js";
import { AccountBadge } from "./AccountBadge.js";

// App chrome: a quiet sidebar (nav + per-account filters) around the content.
export function Layout() {
  const { data: accounts } = useAccounts();
  const { data: billing } = useBillingState();
  const [params] = useSearchParams();
  const activeAccount = params.get("account");

  const trialDaysLeft = billing?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(billing.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="flex h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="px-5 pb-2 pt-5 text-lg font-semibold tracking-tight">Uni-Inbox</div>

        <nav className="flex-1 overflow-y-auto px-3 py-2">
          <NavLink to="/compose" className="btn mb-4 w-full">
            Compose
          </NavLink>

          <SidebarLink to="/" label="Inbox" />
          <SidebarLink to="/archived" label="Archived" />

          {accounts && accounts.length > 0 && (
            <div className="mt-5">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Inboxes
              </div>
              <NavLink
                to="/"
                end
                className={() =>
                  `block rounded-lg px-2 py-1.5 text-sm ${
                    !activeAccount ? "font-medium text-zinc-900" : "text-zinc-500 hover:bg-zinc-50"
                  }`
                }
              >
                All inboxes
              </NavLink>
              {accounts.map((a) => (
                <NavLink
                  key={a.id}
                  to={`/?account=${a.id}`}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                    activeAccount === a.id
                      ? "bg-zinc-100 font-medium text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  <AccountBadge color={a.color} />
                  <span className="truncate">{a.label}</span>
                  {a.status !== "active" && (
                    <span
                      className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                      title={a.status === "auth_failed" ? "Sign-in failed" : "Paused"}
                    />
                  )}
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <div className="border-t border-zinc-100 px-3 py-3 text-sm">
          {billing?.plan === "trial" && trialDaysLeft !== null && (
            <NavLink
              to="/billing"
              className="mb-2 block rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800"
            >
              {billing.trial_expired
                ? "Trial ended. Pick a plan."
                : `Trial: ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`}
            </NavLink>
          )}
          <SidebarLink to="/accounts" label="Connected inboxes" />
          <SidebarLink to="/billing" label="Plan and billing" />
          <button
            className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-sm text-zinc-500 hover:bg-zinc-50"
            onClick={() => void supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function SidebarLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `block rounded-lg px-2 py-1.5 text-sm ${
          isActive ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-600 hover:bg-zinc-50"
        }`
      }
    >
      {label}
    </NavLink>
  );
}
