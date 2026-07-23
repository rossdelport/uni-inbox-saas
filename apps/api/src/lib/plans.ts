import type { PlanId } from "@uni/shared";
import { supabase } from "./supabase.js";

// Inbox-count tiers. Trial matches solo so the paywall moment is "I want my
// third inbox", not "my trial ended" — the product sells itself at the exact
// moment the user feels the multi-inbox pain.
export interface Plan {
  id: PlanId;
  label: string;
  maxInboxes: number;
  priceUsd: number; // display only; Stripe prices are the billing truth
}

export const PLANS: Record<PlanId, Plan> = {
  trial: { id: "trial", label: "Free trial", maxInboxes: 2, priceUsd: 0 },
  solo: { id: "solo", label: "Solo", maxInboxes: 2, priceUsd: 5 },
  builder: { id: "builder", label: "Builder", maxInboxes: 5, priceUsd: 10 },
  empire: { id: "empire", label: "Empire", maxInboxes: 12, priceUsd: 20 },
};

export interface ProfileBilling {
  plan: Plan;
  planId: PlanId;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  /** True when the user is on 'trial' AND the 14 days have lapsed. */
  trialExpired: boolean;
}

/** The caller's plan + trial state (defaults to trial if no profile row yet). */
export async function getBilling(uid: string): Promise<ProfileBilling> {
  const { data } = await supabase
    .from("profiles")
    .select("plan, subscription_status, trial_ends_at")
    .eq("user_id", uid)
    .maybeSingle();
  const planId = (data?.plan as PlanId) ?? "trial";
  const plan = PLANS[planId] ?? PLANS.trial;
  const trialEndsAt = (data?.trial_ends_at as string | null) ?? null;
  const trialExpired =
    planId === "trial" && trialEndsAt !== null && new Date(trialEndsAt).getTime() < Date.now();
  return {
    plan,
    planId,
    subscriptionStatus: (data?.subscription_status as string | null) ?? null,
    trialEndsAt,
    trialExpired,
  };
}
