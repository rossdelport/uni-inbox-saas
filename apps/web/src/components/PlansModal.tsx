import { useEffect, useState } from "react";
import { useBillingState, useCheckout, usePortal } from "../lib/queries.js";

// Kit-styled modal shell: .uni-modal-bg fades in with the "open" class.
export function ModalShell({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true));
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className={`uni-modal-bg ${open ? "open" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="uni-modal" role="dialog" aria-modal="true">
        <button className="m-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h3>{title}</h3>
        {sub && <p className="m-sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

// "Choose your plan": the real Stripe tiers in the kit's .m-plans cards.
export function PlansModal({ onClose }: { onClose: () => void }) {
  const { data: billing } = useBillingState();
  const checkout = useCheckout();
  const portal = usePortal();

  if (!billing) return null;
  const isPaid = billing.plan !== "trial";

  return (
    <ModalShell
      title="Choose your plan"
      sub={
        isPaid ? (
          <>
            You are currently on the <b>{billing.plan_label}</b> plan ($
            {billing.plans.find((p) => p.id === billing.plan)?.price_usd}/month, up to{" "}
            {billing.max_inboxes} accounts). Switch anytime.
          </>
        ) : billing.trial_expired ? (
          "Your free trial has ended. Pick a plan to keep every inbox syncing."
        ) : (
          "You are currently on the free trial. Pick a plan anytime, switch whenever you like."
        )
      }
      onClose={onClose}
    >
      <div className="m-plans">
        {billing.plans.map((p) => {
          const current = billing.plan === p.id;
          const featured = p.id === "builder" && !current;
          return (
            <div key={p.id} className={`m-plan ${featured ? "best" : ""}`}>
              {current && <span className="badge-cur">Current plan</span>}
              {featured && (
                <span className="badge-cur" style={{ background: "#111" }}>
                  Best value
                </span>
              )}
              <div className="pname">{p.label}</div>
              <div className="price">
                ${p.price_usd}
                <small>/month</small>
              </div>
              <ul>
                <li>{p.max_inboxes} email accounts included</li>
                <li>Unified inbox and search</li>
                <li>Reply from the right address</li>
                <li>{p.id === "empire" ? "Room for every side project" : "Cancel anytime"}</li>
              </ul>
              {current ? (
                <button className="btn-black" style={{ height: 44, fontSize: 14, opacity: 0.45, cursor: "default" }} disabled>
                  Current plan
                </button>
              ) : isPaid ? (
                <button
                  className="btn-black"
                  style={{ height: 44, fontSize: 14 }}
                  disabled={portal.isPending}
                  onClick={() => portal.mutate()}
                >
                  {portal.isPending ? "Opening…" : `Switch to ${p.label}`}
                </button>
              ) : (
                <button
                  className="btn-black"
                  style={{ height: 44, fontSize: 14 }}
                  disabled={checkout.isPending}
                  onClick={() => checkout.mutate(p.id)}
                >
                  {checkout.isPending ? "Redirecting…" : `Choose ${p.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {(checkout.error || portal.error) && (
        <p className="err">{((checkout.error ?? portal.error) as Error).message}</p>
      )}
      <p style={{ marginTop: 16, fontSize: 12, color: "var(--ink3)", textAlign: "center" }}>
        Downgrading pauses your newest accounts past the new limit, nothing is deleted.
      </p>
    </ModalShell>
  );
}
