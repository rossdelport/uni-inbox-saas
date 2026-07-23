import { useBillingState, useCheckout, usePortal } from "../lib/queries.js";

// "Choose your plan" modal: current plan gets a blue badge and a disabled
// gray button, the featured tier a black "Best value" badge and blue border.
export function PlansModal({ onClose }: { onClose: () => void }) {
  const { data: billing } = useBillingState();
  const checkout = useCheckout();
  const portal = usePortal();

  if (!billing) return null;
  const isPaid = billing.plan !== "trial";
  const featuredId = "builder";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-zinc-900/25 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-[32px] bg-white p-7 shadow-[0_30px_80px_rgba(15,23,42,0.25)] sm:p-9"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-6 top-6 grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="text-[28px] font-bold tracking-tight text-zinc-900">Choose your plan</h2>
        <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-zinc-500">
          {isPaid ? (
            <>
              You are currently on the{" "}
              <span className="font-semibold text-zinc-800">{billing.plan_label}</span> plan ($
              {billing.plans.find((p) => p.id === billing.plan)?.price_usd}/month, up to{" "}
              {billing.max_inboxes} accounts). Switch anytime.
            </>
          ) : billing.trial_expired ? (
            "Your free trial has ended. Pick a plan to keep every inbox syncing."
          ) : (
            "You are currently on the free trial. Pick a plan anytime, switch whenever you like."
          )}
        </p>

        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {billing.plans.map((p) => {
            const current = billing.plan === p.id;
            const featured = p.id === featuredId && !current;
            const perks = [
              `${p.max_inboxes} email accounts included`,
              "Unified inbox and search",
              "Reply from the right address",
              p.id === "empire" ? "Room for every side project" : "Cancel anytime",
            ];
            return (
              <div
                key={p.id}
                className="relative rounded-3xl border p-6"
                style={
                  featured
                    ? { borderColor: "#1c7ef7", borderWidth: 1.5 }
                    : { borderColor: "#e4e4e7" }
                }
              >
                {current && (
                  <span
                    className="absolute -top-4 right-4 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white"
                    style={{ background: "#4f8ef7" }}
                  >
                    Current plan
                  </span>
                )}
                {featured && (
                  <span className="absolute -top-4 right-4 rounded-full bg-black px-4 py-1.5 text-[13px] font-semibold text-white">
                    Best value
                  </span>
                )}

                <div className="text-[17px] font-semibold text-zinc-900">{p.label}</div>
                <div className="mt-2 text-[34px] font-bold tracking-tight text-zinc-900">
                  ${p.price_usd}
                  <span className="text-[15px] font-medium text-zinc-400">/month</span>
                </div>

                <ul className="mt-4 space-y-2.5">
                  {perks.map((perk) => (
                    <li key={perk} className="flex items-start gap-2 text-[14px] text-zinc-600">
                      <span className="mt-0.5 font-bold" style={{ color: "#16a34a" }}>
                        ✓
                      </span>
                      {perk}
                    </li>
                  ))}
                </ul>

                <div className="mt-6">
                  {current ? (
                    <button
                      disabled
                      className="w-full cursor-default rounded-full bg-zinc-300 py-3 text-[15px] font-semibold text-white"
                    >
                      Current plan
                    </button>
                  ) : isPaid ? (
                    <button
                      className="w-full rounded-full bg-black py-3 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                      disabled={portal.isPending}
                      onClick={() => portal.mutate()}
                    >
                      {portal.isPending ? "Opening…" : `Switch to ${p.label}`}
                    </button>
                  ) : (
                    <button
                      className="w-full rounded-full bg-black py-3 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                      disabled={checkout.isPending}
                      onClick={() => checkout.mutate(p.id)}
                    >
                      {checkout.isPending ? "Redirecting…" : `Choose ${p.label}`}
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

        <p className="mt-6 text-[13px] leading-relaxed text-zinc-400">
          Downgrading pauses your newest accounts past the new limit, nothing is deleted. Manage
          cards and invoices anytime from Settings.
        </p>
      </div>
    </div>
  );
}
