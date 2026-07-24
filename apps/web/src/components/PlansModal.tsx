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

// "Choose your plan": Monthly ($5, 3 accounts, +$2 per extra) and Lifetime
// ($50 once, 10 accounts), exactly like the marketing site's pricing.
export function PlansModal({ onClose }: { onClose: () => void }) {
  const { data: billing } = useBillingState();
  const checkout = useCheckout();
  const portal = usePortal();

  if (!billing) return null;
  const p = billing.pricing;
  const isMonthly = billing.plan === "monthly";
  const isLifetime = billing.plan === "lifetime";

  return (
    <ModalShell
      title="Choose your plan"
      sub={
        <>
          You are currently on the <b>{billing.plan_label}</b> plan ({billing.price_label}, up to{" "}
          {billing.max_inboxes} accounts). Switch anytime.
        </>
      }
      onClose={onClose}
    >
      <div className="m-plans">
        <div className="m-plan">
          {isMonthly && <span className="badge-cur">Current plan</span>}
          <div className="pname">Monthly</div>
          <div className="price">
            ${p.monthly_base_usd}
            <small>/month</small>
          </div>
          <ul>
            <li>{p.monthly_included} email accounts included</li>
            <li>+${p.monthly_per_extra_usd}/month per extra account</li>
            <li>Unified inbox, search and views</li>
            <li>Cancel anytime</li>
          </ul>
          {isMonthly ? (
            <button className="btn-black" style={{ height: 44, fontSize: 14, opacity: 0.45, cursor: "default" }} disabled>
              Current plan
            </button>
          ) : isLifetime ? (
            <button className="btn-black" style={{ height: 44, fontSize: 14, opacity: 0.45, cursor: "default" }} disabled>
              Covered by Lifetime
            </button>
          ) : (
            <button
              className="btn-black"
              style={{ height: 44, fontSize: 14 }}
              disabled={checkout.isPending}
              onClick={() => checkout.mutate("monthly")}
            >
              {checkout.isPending ? "Redirecting…" : "Choose Monthly"}
            </button>
          )}
        </div>

        <div className="m-plan best">
          {isLifetime ? (
            <span className="badge-cur">Current plan</span>
          ) : (
            <span className="badge-cur" style={{ background: "#111" }}>
              Best value
            </span>
          )}
          <div className="pname">Lifetime</div>
          <div className="price">
            ${p.lifetime_usd}
            <small> one-time</small>
          </div>
          <ul>
            <li>Up to {p.lifetime_max} email accounts included</li>
            <li>Every future update, forever</li>
            <li>Unified inbox, search and views</li>
            <li>30-day money-back guarantee</li>
          </ul>
          {isLifetime ? (
            <button className="btn-black" style={{ height: 44, fontSize: 14, opacity: 0.45, cursor: "default" }} disabled>
              Current plan
            </button>
          ) : (
            <button
              className="btn-black"
              style={{ height: 44, fontSize: 14 }}
              disabled={checkout.isPending}
              onClick={() => checkout.mutate("lifetime")}
            >
              {checkout.isPending ? "Redirecting…" : "Switch to Lifetime"}
            </button>
          )}
        </div>
      </div>

      {(checkout.error || portal.error) && (
        <p className="err">{((checkout.error ?? portal.error) as Error).message}</p>
      )}
      <p style={{ marginTop: 16, fontSize: 12, color: "var(--ink3)", textAlign: "center" }}>
        {isMonthly
          ? "Extra accounts are added from the app when you need them. Cancel or change your card in Manage billing."
          : "Changing plans never deletes anything. Accounts past a new limit just pause."}
      </p>
    </ModalShell>
  );
}
