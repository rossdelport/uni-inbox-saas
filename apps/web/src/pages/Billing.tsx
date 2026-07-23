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
    <div className="fade-panel mx-auto min-h-full max-w-4xl rounded-[24px] px-6 py-8">
      <div className="chip mb-3 text-[12px]" style={{ color: "var(--ink-45)" }}>
        💳 Pricing
      </div>
      <h1 className="font-display mb-1 text-3xl font-extrabold tracking-tight">
        Simple <span style={{ color: "var(--blue-primary)" }}>pricing</span>.
      </h1>
      <p className="mb-7 max-w-lg text-sm leading-relaxed" style={{ color: "var(--ink-50)" }}>
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

      <div className="grid gap-5 sm:grid-cols-3">
        {billing.plans.map((p, i) => {
          const current = billing.plan === p.id;
          const featured = i === 1; // middle card gets the spotlight
          const perks = [
            `${p.max_inboxes} connected inbox${p.max_inboxes === 1 ? "" : "es"}`,
            "Unified color coded inbox",
            "Reply from the right address",
            "Two way read and archive sync",
            ...(i >= 1 ? ["Priority sync"] : []),
            ...(i >= 2 ? ["Room for every side project"] : []),
          ];
          return (
            <div
              key={p.id}
              className="card-lg relative p-6"
              style={
                featured
                  ? { boxShadow: "var(--shadow-float)", border: "1.5px solid var(--blue-primary)" }
                  : undefined
              }
            >
              {featured && (
                <span
                  className="font-ui absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full px-3.5 py-1 text-[11px] font-bold text-white"
                  style={{ background: "var(--blue-primary)", boxShadow: "var(--shadow-card)" }}
                >
                  🏅 Most popular
                </span>
              )}
              <div className="font-ui text-sm font-bold">{p.label}</div>
              <div className="font-display mt-2 text-4xl font-extrabold tracking-tight">
                ${p.price_usd}
                <span className="font-ui text-sm font-medium" style={{ color: "var(--ink-45)" }}>
                  /month
                </span>
              </div>
              <ul className="mt-4 space-y-2.5">
                {perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-[13.5px]" style={{ color: "var(--ink-83)" }}>
                    <span
                      className="mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
                      style={{ background: "var(--blue-primary)", width: 18, height: 18 }}
                    >
                      ✓
                    </span>
                    {perk}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {current ? (
                  <span className="chip w-full justify-center py-2" style={{ color: "var(--ink-50)" }}>
                    Current plan
                  </span>
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
                    {checkout.isPending ? "Redirecting…" : "Get started today"}
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
