import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";

// Stripe Checkout lands back here (?checkout=success&session_id=...).
// Confirm the session for an instant plan flip, then hand off to Settings.
export function Billing() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);
  const confirmed = useRef(false);

  const sessionId = params.get("session_id");
  const isReturn = params.get("checkout") === "success" && sessionId;

  useEffect(() => {
    if (!isReturn || confirmed.current) return;
    confirmed.current = true;
    void api(`/api/billing/confirm?session_id=${encodeURIComponent(sessionId!)}`)
      .then(() => toast("Subscription active. Welcome aboard.", "success"))
      .catch(() => undefined)
      .finally(() => {
        void qc.invalidateQueries({ queryKey: ["billing"] });
        setDone(true);
      });
  }, [isReturn, sessionId, qc]);

  if (!isReturn || done) return <Navigate to="/settings?pane=plan" replace />;
  return (
    <div className="set-content" style={{ flex: 1 }}>
      <div className="set-pane active">
        <h1>Confirming your subscription…</h1>
        <p className="p-sub">One moment.</p>
      </div>
    </div>
  );
}
