import { NavLink, Outlet, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase.js";
import { useAccounts, useBillingState } from "../lib/queries.js";
import { AccountBadge } from "./AccountBadge.js";

// App chrome in the Maily language: an off-white canvas with a floating white
// rounded sidebar panel, pill nav items, and the dark pill Compose button.
export function Layout() {
  const { data: accounts } = useAccounts();
  const { data: billing } = useBillingState();
  const [params] = useSearchParams();
  const activeAccount = params.get("account");

  const trialDaysLeft = billing?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(billing.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="flex h-screen gap-4 p-4">
      <aside className="card flex w-64 shrink-0 flex-col overflow-hidden">
        <div className="px-5 pb-1 pt-5">
          <span className="font-display text-xl font-extrabold tracking-tight">
            Uni<span style={{ color: "var(--blue-primary)" }}>-</span>Inbox
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          <NavLink to="/compose" className="btn mb-4 w-full">
            ✏️ Compose
          </NavLink>

          <SidebarLink to="/" label="Inbox" icon="📥" />
          <SidebarLink to="/archived" label="Archived" icon="🗂️" />

          {accounts && accounts.length > 0 && (
            <div className="mt-5">
              <div className="font-ui px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-45)" }}>
                Inboxes
              </div>
              <NavLink
                to="/"
                end
                className="font-ui block rounded-full px-3 py-2 text-sm font-medium transition"
                style={
                  !activeAccount
                    ? { background: "var(--blue-100)", color: "var(--ink)" }
                    : { color: "var(--ink-50)" }
                }
              >
                All inboxes
              </NavLink>
              {accounts.map((a) => (
                <NavLink
                  key={a.id}
                  to={`/?account=${a.id}`}
                  className="font-ui flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition hover:bg-[#f5f5f5]"
                  style={
                    activeAccount === a.id
                      ? { background: "var(--blue-100)", color: "var(--ink)" }
                      : { color: "var(--ink-50)" }
                  }
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

        <div className="border-t px-3 py-3 text-sm" style={{ borderColor: "var(--ink-10)" }}>
          {billing?.plan === "trial" && trialDaysLeft !== null && (
            <NavLink
              to="/billing"
              className="mb-2 block rounded-2xl px-3.5 py-2.5 text-[13px] font-medium"
              style={{ background: "var(--blue-100)", color: "#0a4fa8" }}
            >
              {billing.trial_expired
                ? "Trial ended. Pick a plan →"
                : `Free trial: ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`}
            </NavLink>
          )}
          <SidebarLink to="/accounts" label="Connected inboxes" icon="🔌" />
          <SidebarLink to="/billing" label="Plan and billing" icon="💳" />
          <button
            className="font-ui mt-1 w-full rounded-full px-3 py-2 text-left text-sm font-medium transition hover:bg-[#f5f5f5]"
            style={{ color: "var(--ink-45)" }}
            onClick={() => void supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="card min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function SidebarLink({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className="font-ui block rounded-full px-3 py-2 text-sm font-medium transition hover:bg-[#f5f5f5]"
      style={({ isActive }) =>
        isActive
          ? { background: "var(--blue-100)", color: "var(--ink)" }
          : { color: "var(--ink-50)" }
      }
    >
      <span className="mr-1.5">{icon}</span>
      {label}
    </NavLink>
  );
}
