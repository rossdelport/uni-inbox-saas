import { useState } from "react";
import { Link } from "react-router-dom";
import type { EmailAccount } from "../lib/types.js";
import {
  useAccounts,
  useBillingState,
  useRemoveAccount,
  useUpdateAccount,
} from "../lib/queries.js";
import { AccountBadge } from "../components/AccountBadge.js";
import { ConnectAccountModal } from "../components/ConnectAccountModal.js";

export function Accounts() {
  const { data: accounts, isLoading } = useAccounts();
  const { data: billing } = useBillingState();
  const [connectOpen, setConnectOpen] = useState(false);

  const atCap =
    billing !== undefined && billing.connected_inboxes >= billing.max_inboxes;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Connected inboxes</h1>
          {billing && (
            <p className="text-sm text-zinc-500">
              {billing.connected_inboxes} of {billing.max_inboxes} on the {billing.plan_label} plan
            </p>
          )}
        </div>
        {atCap ? (
          <Link to="/billing" className="btn">
            Upgrade to add more
          </Link>
        ) : (
          <button className="btn" onClick={() => setConnectOpen(true)}>
            Connect an inbox
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-sm text-zinc-400">Loading…</div>
      ) : (
        <div className="space-y-3">
          {(accounts ?? []).map((a) => (
            <AccountCard key={a.id} account={a} />
          ))}
          {(accounts ?? []).length === 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
              No inboxes connected yet.
            </div>
          )}
        </div>
      )}

      {connectOpen && <ConnectAccountModal onClose={() => setConnectOpen(false)} />}
    </div>
  );
}

function AccountCard({ account }: { account: EmailAccount }) {
  const update = useUpdateAccount();
  const remove = useRemoveAccount();
  const [fixOpen, setFixOpen] = useState(false);
  const [password, setPassword] = useState("");

  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <AccountBadge color={account.color} size={10} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{account.label}</span>
            {account.status === "auth_failed" && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                Sign-in failed
              </span>
            )}
            {account.status === "disabled" && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                Paused
              </span>
            )}
          </div>
          <div className="truncate text-xs text-zinc-500">{account.email_address}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          {account.status === "auth_failed" && (
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setFixOpen((v) => !v)}>
              Update password
            </button>
          )}
          {account.status === "disabled" ? (
            <button
              className="btn-ghost px-3 py-1.5 text-xs"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: account.id, status: "active" })}
            >
              Re-enable
            </button>
          ) : (
            <button
              className="btn-ghost px-3 py-1.5 text-xs"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: account.id, status: "disabled" })}
            >
              Pause
            </button>
          )}
          <button
            className="btn-ghost px-3 py-1.5 text-xs text-red-600"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Remove ${account.email_address}? Its synced mail disappears from Uni-Inbox (the mailbox itself is untouched).`,
                )
              ) {
                remove.mutate(account.id);
              }
            }}
          >
            Remove
          </button>
        </div>
      </div>

      {account.last_error && account.status !== "active" && (
        <p className="mt-2 text-xs text-red-600">{account.last_error}</p>
      )}

      {fixOpen && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!password) return;
            update.mutate(
              { id: account.id, password },
              {
                onSuccess: () => {
                  setFixOpen(false);
                  setPassword("");
                },
              },
            );
          }}
        >
          <input
            className="input flex-1"
            type="password"
            autoComplete="off"
            placeholder="New password / app password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn" type="submit" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      )}
      {(update.error || remove.error) && (
        <p className="mt-2 text-xs text-red-600">
          {((update.error ?? remove.error) as Error).message}
        </p>
      )}
    </div>
  );
}
