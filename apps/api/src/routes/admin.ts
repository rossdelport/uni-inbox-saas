import { Router } from "express";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { userEmail } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { PRICING } from "../lib/plans.js";
import type { PlanId } from "@uni/shared";

// Owner-only founder dashboard data. Double gate: the signed-in user must be
// the owner email AND supply the admin password header.

export const adminRouter = Router();

adminRouter.use((req, res, next) => {
  if (userEmail(res)?.toLowerCase() !== env.CONTACT_TO_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: "not available" });
  }
  if (String(req.headers["x-admin-password"] ?? "") !== env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: "wrong admin password" });
  }
  next();
});

function monthlyMrr(quantity: number | null | undefined): number {
  const qty = Math.max(PRICING.monthlyIncluded, quantity ?? PRICING.monthlyIncluded);
  return PRICING.monthlyBaseUsd + Math.max(0, qty - PRICING.monthlyIncluded) * PRICING.monthlyPerExtraUsd;
}

adminRouter.get("/users", async (_req, res) => {
  // Emails + signup attribution live in auth; billing state lives on profiles.
  const [{ data: authList, error: authErr }, { data: profiles }] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("profiles").select("*"),
  ]);
  if (authErr) {
    logger.error({ authErr }, "admin listUsers failed");
    return res.status(500).json({ error: "could not list users" });
  }

  const profByUser = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const now = Date.now();

  const users = (authList?.users ?? [])
    .map((u) => {
      const p = profByUser.get(u.id) ?? {};
      const rawPlan = (p as { plan?: string }).plan ?? "trial";
      const plan: PlanId = rawPlan === "monthly" || rawPlan === "lifetime" ? rawPlan : "trial";
      const qty = (p as { monthly_quantity?: number | null }).monthly_quantity;
      const trialEnds = (p as { trial_ends_at?: string | null }).trial_ends_at ?? null;
      const mrr = plan === "monthly" ? monthlyMrr(qty) : 0;
      return {
        email: u.email ?? "(no email)",
        joined_at: u.created_at,
        plan,
        plan_label:
          plan === "lifetime"
            ? "Lifetime"
            : plan === "monthly"
              ? `Monthly (${Math.max(PRICING.monthlyIncluded, qty ?? PRICING.monthlyIncluded)} accounts)`
              : trialEnds && new Date(trialEnds).getTime() < now
                ? "Trial ended"
                : "Free trial",
        mrr_usd: mrr,
        trial_ends_at: plan === "trial" ? trialEnds : null,
        subscription_status: (p as { subscription_status?: string | null }).subscription_status ?? null,
        signup_source: (u.user_metadata?.signup_source as string | undefined) ?? null,
      };
    })
    .sort((a, b) => (b.joined_at > a.joined_at ? 1 : -1));

  // Cash collected: sum of paid Stripe charges (gross) minus refunds.
  let cash: { collected_usd: number; refunded_usd: number } | null = null;
  if (env.STRIPE_SECRET_KEY) {
    try {
      const { getStripe } = await import("../services/stripeBilling.js");
      const stripe = getStripe();
      let collected = 0;
      let refunded = 0;
      let scanned = 0;
      for await (const ch of stripe.charges.list({ limit: 100 })) {
        if (ch.paid) {
          collected += ch.amount;
          refunded += ch.amount_refunded;
        }
        if (++scanned >= 1000) break; // plenty for a long while
      }
      cash = { collected_usd: collected / 100, refunded_usd: refunded / 100 };
    } catch (err) {
      logger.warn({ err }, "admin stripe cash lookup failed");
    }
  }

  const trialsActive = users.filter(
    (u) => u.plan === "trial" && u.trial_ends_at && new Date(u.trial_ends_at).getTime() >= now,
  ).length;

  res.json({
    totals: {
      users: users.length,
      paying_monthly: users.filter((u) => u.plan === "monthly").length,
      lifetime: users.filter((u) => u.plan === "lifetime").length,
      trials_active: trialsActive,
      mrr_usd: users.reduce((n, u) => n + u.mrr_usd, 0),
      cash_collected_usd: cash?.collected_usd ?? null,
      refunded_usd: cash?.refunded_usd ?? null,
    },
    users,
  });
});
