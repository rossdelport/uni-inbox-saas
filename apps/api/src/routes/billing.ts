import { Router } from "express";
import { z } from "zod";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { getBilling, PLANS } from "../lib/plans.js";
import {
  confirmCheckout,
  createCheckoutSession,
  createPortalSession,
} from "../services/stripeBilling.js";

// Authenticated billing endpoints (mounted under /api/billing, behind
// requireAuth). The webhook is NOT here — it needs the raw body and no auth,
// so it's registered directly in index.ts above the json parser.
export const billingRouter = Router();

// Current plan + usage, drives the Billing page and the paywall banners.
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
    max_inboxes: billing.plan.maxInboxes,
    connected_inboxes: count ?? 0,
    subscription_status: billing.subscriptionStatus,
    trial_ends_at: billing.trialEndsAt,
    trial_expired: billing.trialExpired,
    plans: Object.values(PLANS)
      .filter((p) => p.id !== "trial")
      .map((p) => ({ id: p.id, label: p.label, max_inboxes: p.maxInboxes, price_usd: p.priceUsd })),
  });
});

// Start a Checkout session. Body: { tier: "solo" | "builder" | "empire" }.
billingRouter.post("/checkout", async (req, res) => {
  const parsed = z
    .object({ tier: z.enum(["solo", "builder", "empire"]) })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid tier" });
  try {
    const url = await createCheckoutSession(userId(res), parsed.data.tier);
    res.json({ url });
  } catch (err) {
    logger.error({ err, uid: userId(res) }, "checkout session failed");
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

// Stripe-hosted billing portal (cancel, change plan, change card, invoices).
billingRouter.post("/portal", async (_req, res) => {
  try {
    const url = await createPortalSession(userId(res));
    res.json({ url });
  } catch (err) {
    logger.error({ err, uid: userId(res) }, "billing portal failed");
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
