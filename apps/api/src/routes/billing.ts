import { Router } from "express";
import { z } from "zod";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { getBilling, planPriceLabel, PRICING } from "../lib/plans.js";
import {
  addSeat,
  confirmCheckout,
  createCheckoutSession,
  createPortalSession,
} from "../services/stripeBilling.js";

// Authenticated billing endpoints (mounted under /api/billing, behind
// requireAuth). The webhook is NOT here — it needs the raw body and no auth,
// so it's registered directly in index.ts above the json parser.
export const billingRouter = Router();

// Current plan + usage, drives the plans modal, paywall and Settings.
billingRouter.get("/state", async (_req, res) => {
  const uid = userId(res);
  const billing = await getBilling(uid);
  const { count } = await supabase
    .from("email_accounts")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", uid)
    .neq("status", "disabled");
  res.json({
    plan: billing.planId,
    plan_label: billing.plan.label,
    price_label: planPriceLabel(billing.planId, billing.monthlyQuantity),
    max_inboxes: billing.plan.maxInboxes,
    connected_inboxes: count ?? 0,
    monthly_quantity: billing.monthlyQuantity,
    subscription_status: billing.subscriptionStatus,
    trial_ends_at: billing.trialEndsAt,
    trial_expired: billing.trialExpired,
    pricing: {
      monthly_base_usd: PRICING.monthlyBaseUsd,
      monthly_included: PRICING.monthlyIncluded,
      monthly_per_extra_usd: PRICING.monthlyPerExtraUsd,
      lifetime_usd: PRICING.lifetimeUsd,
      lifetime_max: PRICING.lifetimeMax,
    },
  });
});

// Start a Checkout session. Body: { tier: "monthly" | "lifetime" }.
billingRouter.post("/checkout", async (req, res) => {
  const parsed = z.object({ tier: z.enum(["monthly", "lifetime"]) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid tier" });
  try {
    const url = await createCheckoutSession(userId(res), parsed.data.tier);
    res.json({ url });
  } catch (err) {
    logger.error({ err, uid: userId(res) }, "checkout session failed");
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// "+$2/month": add one more account seat to the Monthly subscription.
billingRouter.post("/add-seat", async (_req, res) => {
  try {
    const result = await addSeat(userId(res));
    res.json(result);
  } catch (err) {
    logger.error({ err, uid: userId(res) }, "add seat failed");
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Verify the session the user just returned from and flip their plan.
billingRouter.get("/confirm", async (req, res) => {
  const sessionId = String(req.query.session_id ?? "");
  if (!sessionId.startsWith("cs_")) return res.status(400).json({ error: "invalid session id" });
  try {
    const result = await confirmCheckout(userId(res), sessionId);
    res.json(result);
  } catch (err) {
    logger.error({ err, uid: userId(res) }, "checkout confirm failed");
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Stripe-hosted billing portal (cancel, change card, invoices).
billingRouter.post("/portal", async (_req, res) => {
  try {
    const url = await createPortalSession(userId(res));
    res.json({ url });
  } catch (err) {
    logger.error({ err, uid: userId(res) }, "billing portal failed");
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
