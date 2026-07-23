import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useBillingState, useCheckout, usePortal } from "../lib/queries.js";

export function Billing() {
  const { data: billing, isLoading } = useBillingState();
  const checkout = useCheckout();
  const portal = usePortal();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [confirming, setConfirming] = useState(false);
  const confirmed = useRef(false);

  // Landing back from Stripe Checkout: confirm the session -> instant flip.
  useEffect(() => {
    const sessionId = params.get("session_id");
    if (params.get("checkout") === "success" && sessionId && !confirmed.current) {
      confirmed.current = true;
      setConfirming(true);
      void api(`/api/billing/confirm?session_id=${encodeURIComponent(sessionId)}`)
        .catch(() => undefined)
        .finally(() => {
          setConfirming(false);
          setParams({}, { replace: true });
          void qc.invalidateQueries({ queryKey: ["billing"] });
        });
    }
  }, [params, setParams, qc]);

  if (isLoading || !billing) {
    return <div className="p-8 text-sm text-zinc-400">Loading…</div>;
  }

  const isPaid = billing.plan !== "trial";
  const trialDaysLeft = billing.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(billing.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-lg font-semibold">Plan and billing</h1>
      <p className="mb-6 text-sm text-zinc-500">
        {isPaid ? (
          <>
            You're on <span className="font-medium text-zinc-700">{billing.plan_label}</span>
            {billing.subscription_status === "past_due" &&
              ", but the last payment failed. Update your card to keep syncing."}
          </>
        ) : billing.trial_expired ? (
          "Your trial has ended. Pick a plan to keep your inboxes syncing."
        ) : (
          `Free trial, ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left. Pick a plan any time.`
        )}
      </p>

      {confirming && (
        <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Confirming your subscription…
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {billing.plans.map((p) => {
          const current = billing.plan === p.id;
          return (
            <div
              key={p.id}
              className={`rounded-xl border bg-white p-5 ${
                current ? "border-zinc-900" : "border-zinc-200"
              }`}
            >
              <div className="text-sm font-semibold">{p.label}</div>
              <div className="mt-1 text-2xl font-semibold">
                ${p.price_usd}
                <span className="text-sm font-normal text-zinc-400">/mo</span>
              </div>
              <div className="mt-2 text-sm text-zinc-500">
                {p.max_inboxes} connected inbox{p.max_inboxes === 1 ? "" : "es"}
              </div>
              <div className="mt-4">
                {current ? (
                  <span className="text-xs font-medium text-zinc-500">Current plan</span>
                ) : isPaid ? (
                  <button
                    className="btn-ghost w-full"
                    disabled={portal.isPending}
                    onClick={() => portal.mutate()}
                  >
                    Switch in portal
                  </button>
                ) : (
                  <button
                    className="btn w-full"
                    disabled={checkout.isPending}
                    onClick={() => checkout.mutate(p.id)}
                  >
                    {checkout.isPending ? "Redirecting…" : "Choose"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(checkout.error || portal.error) && (
        <p className="mt-4 text-sm text-red-600">
          {((checkout.error ?? portal.error) as Error).message}
        </p>
      )}

      {isPaid && (
        <div className="mt-6">
          <button className="btn-ghost" disabled={portal.isPending} onClick={() => portal.mutate()}>
            {portal.isPending ? "Opening…" : "Manage billing (card, invoices, cancel)"}
          </button>
        </div>
      )}

      <p className="mt-8 text-xs leading-relaxed text-zinc-400">
        Every plan includes reply and send from the right address, per-project color coding, and
        a 90-day rolling mail window. Downgrading pauses your newest inboxes past the new limit,
        nothing is deleted.
      </p>
    </div>
  );
}
