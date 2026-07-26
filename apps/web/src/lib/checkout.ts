import { api } from "./api.js";

// Signup funnel: create the account, then go straight to Stripe with a card
// and a 3-day trial, which converts on its own when the trial is up.
//
// The checkout call is made from inside the app on purpose. An earlier version
// linked the marketing buttons at /api/checkout/start directly, but the
// marketing site is a separate deployment with no /api route, so those links
// hit its 404 page. Everything here runs after sign-in, through the same api()
// helper the rest of the dashboard already uses, so there is one code path to
// keep working instead of two.

const PLAN_KEY = "oi-plan-intent";

export interface PlanIntent {
  tier: "monthly" | "lifetime";
  accounts?: number;
}

/** Read ?plan=monthly&accounts=5 off the signup URL. */
export function planIntentFromUrl(): PlanIntent | null {
  const q = new URLSearchParams(window.location.search);
  const plan = q.get("plan");
  if (plan !== "monthly" && plan !== "lifetime") return null;
  const n = Number(q.get("accounts"));
  return {
    tier: plan,
    accounts: Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined,
  };
}

export function rememberPlanIntent(intent: PlanIntent): void {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(intent));
  } catch {
    /* private mode: the in-page hand-off still works, only the retry is lost */
  }
}

export function pendingPlanIntent(): PlanIntent | null {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PlanIntent;
    return v?.tier === "monthly" || v?.tier === "lifetime" ? v : null;
  } catch {
    return null;
  }
}

export function clearPlanIntent(): void {
  try {
    localStorage.removeItem(PLAN_KEY);
  } catch {
    /* ignore */
  }
}

/** Send a signed-in user to Stripe for the plan they picked on the site.
 *  Returns true if the browser is navigating away, false if there was nothing
 *  pending or checkout could not be started (caller carries on into the app). */
export async function startCheckoutForPendingPlan(): Promise<boolean> {
  const intent = pendingPlanIntent();
  if (!intent) return false;
  try {
    const { url } = await api<{ url: string }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ tier: intent.tier, accounts: intent.accounts }),
    });
    // Clear before navigating: if Stripe is abandoned we do not want to shove
    // them back into checkout on every future load, which would make the
    // dashboard unreachable. The paywall inside the app is the second chance.
    clearPlanIntent();
    window.location.assign(url);
    return true;
  } catch {
    clearPlanIntent();
    return false;
  }
}
