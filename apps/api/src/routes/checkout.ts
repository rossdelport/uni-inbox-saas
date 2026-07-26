import { Router } from "express";
import { logger } from "../lib/logger.js";
import { allow } from "../lib/rateLimit.js";
import { PRICING } from "../lib/plans.js";
import {
  createSignupCheckoutSession,
  signupSessionSummary,
  type CheckoutTier,
} from "../services/stripeBilling.js";

// Unauthenticated checkout, mounted ABOVE requireAuth. This is the card-first
// signup funnel: the visitor pays before an account exists, so none of these
// endpoints can know a user. The session is bound to an account afterwards by
// POST /api/billing/claim, which does require auth.
export const checkoutRouter = Router();

function clientKey(req: { ip?: string; headers: Record<string, unknown> }): string {
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return fwd || req.ip || "unknown";
}

// GET /api/checkout/start?tier=monthly&accounts=5 -> 302 to Stripe.
// A redirect rather than JSON so a plain link can start checkout, and so the
// visitor never sees an intermediate page they could bounce off.
checkoutRouter.get("/start", async (req, res) => {
  const key = clientKey(req as never);
  if (!allow(`checkout-start:${key}`, 12, 600_000)) {
    return res.status(429).send("Too many checkout attempts, try again shortly.");
  }
  const tierRaw = String(req.query.tier ?? "monthly");
  const tier: CheckoutTier = tierRaw === "lifetime" ? "lifetime" : "monthly";
  const accountsRaw = Number(req.query.accounts);
  const accounts = Number.isFinite(accountsRaw) ? Math.trunc(accountsRaw) : null;
  try {
    const url = await createSignupCheckoutSession(
      tier,
      accounts === null ? null : Math.min(Math.max(accounts, PRICING.monthlyIncluded), PRICING.monthlyHardCap),
    );
    return res.redirect(303, url);
  } catch (err) {
    logger.error({ err, tier }, "signup checkout failed");
    return res.status(502).send("Could not start checkout. Please try again.");
  }
});

// GET /api/checkout/session/:id -> the little the signup form needs to
// prefill itself. Returns no card data and no Stripe secrets; the session id
// is already in the buyer's own URL.
checkoutRouter.get("/session/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!id.startsWith("cs_")) return res.status(400).json({ error: "invalid session id" });
  if (!allow(`checkout-session:${clientKey(req as never)}`, 30, 600_000)) {
    return res.status(429).json({ error: "Too many lookups, try again shortly." });
  }
  try {
    res.json(await signupSessionSummary(id));
  } catch (err) {
    logger.warn({ err, id }, "signup session lookup failed");
    res.status(404).json({ error: "That checkout could not be found." });
  }
});
