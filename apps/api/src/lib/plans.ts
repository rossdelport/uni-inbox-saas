import type { PlanId } from "@uni/shared";
import { supabase } from "./supabase.js";

// Pricing: one Monthly plan ($5/month with 3 accounts included, +$2/month per
// extra account, billed as Stripe subscription quantity with graduated tiers)
// and a $50 one-time Lifetime plan (10 accounts). The 14-day trial matches
// Monthly's included 3, so the paywall moment is "I want my fourth inbox".
export const PRICING = {
  monthlyBaseUsd: 5,
  monthlyIncluded: 3,
  monthlyPerExtraUsd: 2,
  lifetimeUsd: 50,
  lifetimeMax: 10,
  trialMax: 3,
  /** Hard ceiling on Monthly seats (sanity bound, not a marketed limit). */
  monthlyHardCap: 25,
} as const;

export function planLabel(planId: PlanId): string {
  return planId === "lifetime" ? "Lifetime" : planId === "monthly" ? "Monthly" : "Free trial";
}

/** Display price for the current state, e.g. "$7/month" or "$50 one-time". */
export function planPriceLabel(planId: PlanId, monthlyQuantity: number): string {
  if (planId === "lifetime") return "$50 one-time";
  if (planId === "monthly") {
    const extras = Math.max(0, monthlyQuantity - PRICING.monthlyIncluded);
    return `$${PRICING.monthlyBaseUsd + extras * PRICING.monthlyPerExtraUsd}/month`;
  }
  return "Free";
}

export interface ProfileBilling {
  planId: PlanId;
  plan: { id: PlanId; label: string; maxInboxes: number };
  /** Stripe subscription quantity while on Monthly (>= 3), else 0. */
  monthlyQuantity: number;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  /** True when the user is on 'trial' AND the 14 days have lapsed. */
  trialExpired: boolean;
}

function maxInboxesFor(planId: PlanId, monthlyQuantity: number): number {
  if (planId === "lifetime") return PRICING.lifetimeMax;
  if (planId === "monthly") return Math.max(PRICING.monthlyIncluded, monthlyQuantity);
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
    rawPlan === "monthly" || legacyQty > 0 ? "monthly" : rawPlan === "lifetime" ? "lifetime" : "trial";
  const monthlyQuantity =
    planId === "monthly"
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
  };
}
