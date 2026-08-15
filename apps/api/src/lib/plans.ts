import type { PlanId } from "@uni/shared";
import { supabase } from "./supabase.js";

// Pricing: Monthly is $10/month with 5 accounts included (+$2 per extra),
// Yearly is $97/year with the same 5-account base and a 20% discount, and
// Lifetime is a $97 one-time purchase for up to 10 accounts.
export const PRICING = {
  monthlyBaseUsd: 10,
  monthlyIncluded: 5,
  monthlyPerExtraUsd: 2,
  yearlyBaseUsd: 97,
  yearlyPerExtraUsd: 19.2,
  yearlyMax: 10,
  lifetimeUsd: 97,
  lifetimeMax: 10,
  trialMax: 3,
  /** Hard ceiling on Monthly seats (sanity bound, not a marketed limit). */
  monthlyHardCap: 25,
} as const;

export function planLabel(planId: PlanId): string {
  return planId === "lifetime"
    ? "Lifetime"
    : planId === "yearly"
      ? "Yearly"
      : planId === "monthly"
        ? "Monthly"
        : "Free trial";
}

/** Display price for the current state, e.g. "$12/month" or "$97/year". */
export function planPriceLabel(planId: PlanId, monthlyQuantity: number): string {
  if (planId === "lifetime") return "$97 one-time";
  if (planId === "monthly") {
    const extras = Math.max(0, monthlyQuantity - PRICING.monthlyIncluded);
    return `$${PRICING.monthlyBaseUsd + extras * PRICING.monthlyPerExtraUsd}/month`;
  }
  if (planId === "yearly") {
    const extras = Math.max(0, monthlyQuantity - PRICING.monthlyIncluded);
    const amount = PRICING.yearlyBaseUsd + extras * PRICING.yearlyPerExtraUsd;
    return `$${amount.toFixed(2).replace(/\.00$/, "")}/year`;
  }
  return "Free";
}

export interface ProfileBilling {
  planId: PlanId;
  plan: { id: PlanId; label: string; maxInboxes: number };
  /** Stripe subscription quantity while on Monthly or Yearly (>= 5), else 0. */
  monthlyQuantity: number;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  /** True when the user is on 'trial' AND the 3 days have lapsed. */
  trialExpired: boolean;
  /** Already present on the profile row; send routes reuse it rather than
   *  paying for a second profile lookup just to format From. */
  displayName: string | null;
}

function maxInboxesFor(planId: PlanId, monthlyQuantity: number): number {
  if (planId === "lifetime") return PRICING.lifetimeMax;
  if (planId === "monthly" || planId === "yearly") {
    const max = Math.max(PRICING.monthlyIncluded, monthlyQuantity);
    return planId === "yearly" ? Math.min(PRICING.yearlyMax, max) : max;
  }
  return PRICING.trialMax;
}

/** The caller's plan + trial state (defaults to trial if no profile row yet). */
export async function getBilling(uid: string): Promise<ProfileBilling> {
  // select("*") stays tolerant of the monthly_quantity column not existing
  // yet (migration 0006 pending) — missing fields just read as undefined.
  const { data } = await supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle();
  const rawPlan = (data?.plan as string) ?? "trial";
  // Old tier ids (pre-0006 rows) count as monthly with their old allowance.
  const legacyQty = rawPlan === "solo" ? 3 : rawPlan === "builder" ? 5 : rawPlan === "empire" ? 12 : 0;
  const planId: PlanId =
    rawPlan === "yearly"
      ? "yearly"
      : rawPlan === "monthly" || legacyQty > 0
        ? "monthly"
        : rawPlan === "lifetime"
          ? "lifetime"
          : "trial";
  const monthlyQuantity =
    planId === "monthly" || planId === "yearly"
      ? Math.max((data?.monthly_quantity as number | undefined) ?? 0, legacyQty, PRICING.monthlyIncluded)
      : 0;
  const trialEndsAt = (data?.trial_ends_at as string | null) ?? null;
  const trialExpired =
    planId === "trial" && trialEndsAt !== null && new Date(trialEndsAt).getTime() < Date.now();
  return {
    planId,
    plan: { id: planId, label: planLabel(planId), maxInboxes: maxInboxesFor(planId, monthlyQuantity) },
    monthlyQuantity,
    subscriptionStatus: (data?.subscription_status as string | null) ?? null,
    trialEndsAt,
    trialExpired,
    displayName: (data?.display_name as string | null) ?? null,
  };
}
