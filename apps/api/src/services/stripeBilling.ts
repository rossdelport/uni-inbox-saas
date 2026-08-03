import Stripe from "stripe";
import type { PlanId } from "@uni/shared";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { getBilling, PRICING } from "../lib/plans.js";

// Stripe billing core. One product ("OneInbox"), three customer-facing prices:
//  - Monthly: $10/month for 5 accounts, then $2 per extra account.
//  - Yearly: $97/year for 5 accounts, then the same 20%-discounted extra-seat
//    rate, capped at 10 accounts.
//  - Lifetime: $97 one-time payment, 10 accounts.
// The 3-day trial is Stripe's, taken with a card up front on the first
// subscription, so it converts on its own instead of needing a second visit.
// Plan flips happen in TWO places on purpose: the authenticated /confirm call
// when the user lands back from Checkout (instant UX) and the webhook
// (renewals, cancellations, and the backstop if the redirect never happens).

let client: Stripe | undefined;
function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Billing isn't configured (STRIPE_SECRET_KEY unset).");
  if (!client) client = new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

/** Shared Stripe client for read-only admin lookups. */
export function getStripe(): Stripe {
  return stripe();
}

export type CheckoutTier = "monthly" | "yearly" | "lifetime";

/** Free days on a first subscription, taken with a card already on file. */
export const SIGNUP_TRIAL_DAYS = 3;

// Prices are resolved (and created on first run) by lookup key, so the only
// required env is STRIPE_SECRET_KEY. STRIPE_PRICE_* env vars act as manual
// overrides if ever needed.
const LOOKUP = {
  monthly: "oneinbox_monthly_v3",
  yearly: "oneinbox_yearly_v1",
  lifetime: "oneinbox_lifetime_v2",
} as const;
const LEGACY_MONTHLY_INCLUDED = 3;
let priceIds: { monthly: string; yearly: string; lifetime: string } | null = null;

export async function ensurePrices(): Promise<{ monthly: string; yearly: string; lifetime: string }> {
  if (priceIds) return priceIds;
  if (env.STRIPE_PRICE_MONTHLY_V2 && env.STRIPE_PRICE_YEARLY && env.STRIPE_PRICE_LIFETIME) {
    priceIds = {
      monthly: env.STRIPE_PRICE_MONTHLY_V2,
      yearly: env.STRIPE_PRICE_YEARLY,
      lifetime: env.STRIPE_PRICE_LIFETIME,
    };
    return priceIds;
  }
  const s = stripe();
  const existing = await s.prices.list({
    lookup_keys: [LOOKUP.monthly, LOOKUP.yearly, LOOKUP.lifetime],
    limit: 10,
  });
  let monthly =
    env.STRIPE_PRICE_MONTHLY_V2 ?? existing.data.find((p) => p.lookup_key === LOOKUP.monthly)?.id;
  let yearly =
    env.STRIPE_PRICE_YEARLY ?? existing.data.find((p) => p.lookup_key === LOOKUP.yearly)?.id;
  let lifetime =
    env.STRIPE_PRICE_LIFETIME ?? existing.data.find((p) => p.lookup_key === LOOKUP.lifetime)?.id;
  if (!monthly || !yearly || !lifetime) {
    const products = await s.products.search({ query: `name:"OneInbox" AND active:"true"` });
    const product =
      products.data[0] ??
      (await s.products.create({
        name: "OneInbox",
        description: "All your project inboxes in one clutter-free place.",
      }));
    if (!monthly) {
      monthly = (
        await s.prices.create({
          product: product.id,
          currency: "usd",
          nickname: "Monthly (5 included, $2 per extra account)",
          lookup_key: LOOKUP.monthly,
          recurring: { interval: "month" },
          billing_scheme: "tiered",
          tiers_mode: "graduated",
          tiers: [
            { up_to: PRICING.monthlyIncluded, flat_amount: 500, unit_amount: 0 },
            { up_to: "inf", unit_amount: 200 },
          ],
        })
      ).id;
    }
    if (!yearly) {
      yearly = (
        await s.prices.create({
          product: product.id,
          currency: "usd",
          nickname: "Yearly (5 included, 20% off)",
          lookup_key: LOOKUP.yearly,
          recurring: { interval: "year" },
          billing_scheme: "tiered",
          tiers_mode: "graduated",
          tiers: [
            { up_to: PRICING.monthlyIncluded, flat_amount: PRICING.yearlyBaseUsd * 100, unit_amount: 0 },
            { up_to: "inf", unit_amount: PRICING.yearlyPerExtraUsd * 100 },
          ],
        })
      ).id;
    }
    if (!lifetime) {
      lifetime = (
        await s.prices.create({
          product: product.id,
          currency: "usd",
          nickname: "Lifetime (10 accounts, one-time)",
          lookup_key: LOOKUP.lifetime,
          unit_amount: PRICING.lifetimeUsd * 100,
        })
      ).id;
    }
  }
  priceIds = { monthly, yearly, lifetime };
  logger.info(priceIds, "stripe prices resolved");
  return priceIds;
}

// The AI add-on price, resolved separately from ensurePrices on purpose: that
// function early-returns when both seat env overrides are set, so a third
// price hung on it would silently never resolve in production.
const AI_LOOKUP = "oneinbox_ai_monthly";
export const AI_ADDON_USD = 3;
let aiPriceId: string | null = null;

export async function ensureAiPrice(): Promise<string> {
  if (aiPriceId) return aiPriceId;
  if (env.STRIPE_PRICE_AI) {
    aiPriceId = env.STRIPE_PRICE_AI;
    return aiPriceId;
  }
  const s = stripe();
  const existing = await s.prices.list({ lookup_keys: [AI_LOOKUP], limit: 1 });
  let price = existing.data[0]?.id;
  if (!price) {
    const products = await s.products.search({ query: `name:"OneInbox AI" AND active:"true"` });
    const product =
      products.data[0] ??
      (await s.products.create({
        name: "OneInbox AI",
        description: "AI thread summaries inside OneInbox.",
      }));
    price = (
      await s.prices.create({
        product: product.id,
        currency: "usd",
        nickname: "AI summaries ($3/month add-on)",
        lookup_key: AI_LOOKUP,
        recurring: { interval: "month" },
        unit_amount: AI_ADDON_USD * 100,
      })
    ).id;
  }
  aiPriceId = price;
  logger.info({ aiPriceId }, "stripe AI add-on price resolved");
  return aiPriceId;
}

/** Checkout for the AI add-on: a SEPARATE subscription on the same customer.
 *  Not a second item on the seat subscription, because four money-handling
 *  call sites read items.data[0] as the seat item and enforceInboxCap would
 *  treat the add-on's quantity as an inbox allowance. */
export async function createAiCheckoutSession(uid: string): Promise<string> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("ai_status")
    .eq("user_id", uid)
    .maybeSingle();
  if (ACTIVE_STATUSES.has((prof?.ai_status as string | null) ?? "")) {
    throw new Error("AI summaries are already on your account.");
  }
  const customer = await getOrCreateCustomer(uid);
  const price = await ensureAiPrice();
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { user_id: uid, addon: "ai" } },
    payment_method_collection: "always",
    metadata: { user_id: uid, addon: "ai" },
    allow_promotion_codes: true,
    success_url: `${env.DASHBOARD_URL}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.DASHBOARD_URL}/billing?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL.");
  return session.url;
}

/** Mirror the AI add-on subscription's state onto the profile. Never touches
 *  plan, seats or the inbox cap: the add-on cannot gate mailboxes. */
export async function applyAiSubscription(uid: string, sub: Stripe.Subscription): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ ai_subscription_id: sub.id, ai_status: sub.status })
    .eq("user_id", uid);
  if (error) logger.error({ err: error, uid, subId: sub.id }, "ai subscription apply failed");
  await supabase.from("billing_events").insert({
    user_id: uid,
    event_type: `ai_addon.${sub.status}`,
    stripe_id: sub.id,
    detail: { addon: "ai" },
  });
  logger.info({ uid, status: sub.status, subId: sub.id }, "ai add-on applied to profile");
}

/** True when this subscription is the AI add-on rather than the seat sub. */
export function isAiSubscription(sub: Stripe.Subscription): boolean {
  if (sub.metadata?.addon === "ai") return true;
  const price = sub.items.data[0]?.price;
  return price?.lookup_key === AI_LOOKUP || (aiPriceId !== null && price?.id === aiPriceId);
}

// Subscription statuses that count as "paying" (past_due keeps access during
// the retry window rather than yanking the account on one failed card).
const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

async function getOrCreateCustomer(uid: string): Promise<string> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("user_id", uid)
    .maybeSingle();
  if (prof?.stripe_customer_id) return prof.stripe_customer_id;

  const { data: u } = await supabase.auth.admin.getUserById(uid);
  const customer = await stripe().customers.create({
    email: u.user?.email ?? undefined,
    metadata: { user_id: uid },
  });
  await supabase.from("profiles").update({ stripe_customer_id: customer.id }).eq("user_id", uid);
  return customer.id;
}

/** Create the Checkout session and return its URL.
 *  `accounts` is the seat count chosen on the marketing slider, if the user
 *  came from there; otherwise the count is derived from what they connected. */
export async function createCheckoutSession(
  uid: string,
  tier: CheckoutTier,
  accounts?: number | null,
): Promise<string> {
  const billing = await getBilling(uid);
  if (billing.planId === "lifetime") {
    throw new Error("You already have Lifetime. There is nothing above it.");
  }
  const customer = await getOrCreateCustomer(uid);
  const base = env.DASHBOARD_URL;

  const prices = await ensurePrices();

  if (tier === "lifetime") {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer,
      line_items: [{ price: prices.lifetime, quantity: 1 }],
      metadata: { user_id: uid, tier: "lifetime" },
      allow_promotion_codes: true,
      success_url: `${base}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?checkout=cancelled`,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL.");
    return session.url;
  }

  // Monthly or Yearly. Guard: one live subscription per account — a retried confirm or
  // double-submitted form must not stack two subscriptions. Seat changes go
  // through /add-seat, cancel through the portal.
  if (ACTIVE_STATUSES.has(billing.subscriptionStatus ?? "")) {
    throw new Error("You already have an active subscription. Manage it in Settings, Plan and Billing.");
  }

  // Start with enough seats for what's already connected (>= 3).
  const { count } = await supabase
    .from("email_accounts")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", uid)
    .neq("status", "disabled");
  const requested = Math.max(PRICING.monthlyIncluded, accounts ?? 0, count ?? 0);
  const quantity = Math.min(requested, tier === "yearly" ? PRICING.yearlyMax : PRICING.monthlyHardCap);

  // Only a brand new subscriber gets the trial. Without this check, cancelling
  // and resubscribing would hand out another free 3 days every time.
  const firstTime = !billing.subscriptionStatus;

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: tier === "yearly" ? prices.yearly : prices.monthly, quantity }],
    subscription_data: {
      metadata: { user_id: uid },
      // Card is taken up front and the trial converts on its own when it ends.
      ...(firstTime ? { trial_period_days: SIGNUP_TRIAL_DAYS } : {}),
    },
    payment_method_collection: "always",
    metadata: { user_id: uid, tier },
    allow_promotion_codes: true,
    success_url: `${base}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/billing?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL.");
  return session.url;
}

/** "+$2/month" paywall button: bump the Monthly subscription by one seat. */
export async function addSeat(uid: string): Promise<{ quantity: number }> {
  const billing = await getBilling(uid);
  if ((billing.planId !== "monthly" && billing.planId !== "yearly") || !ACTIVE_STATUSES.has(billing.subscriptionStatus ?? "")) {
    throw new Error("Adding a seat needs an active Monthly or Yearly subscription.");
  }
  const { data: prof } = await supabase
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("user_id", uid)
    .maybeSingle();
  const subId = prof?.stripe_subscription_id as string | null;
  if (!subId) throw new Error("No subscription on file. Contact support.");

  const sub = await migrateMonthlySubscriptionPrice(await stripe().subscriptions.retrieve(subId));
  const item = sub.items.data[0];
  if (!item) throw new Error("Subscription has no items. Contact support.");
  const current = item.quantity ?? PRICING.monthlyIncluded;
  const quantity = Math.min(current + 1, billing.planId === "yearly" ? PRICING.yearlyMax : PRICING.monthlyHardCap);
  if (quantity === current) throw new Error("Seat limit reached. Contact support for more.");

  const updated = await stripe().subscriptions.update(subId, {
    items: [{ id: item.id, quantity }],
    proration_behavior: "create_prorations",
  });
  await applySubscription(uid, updated);
  return { quantity };
}

/**
 * Move a subscription from the original 3-included Stripe price to the
 * current 5-included price without changing what the customer pays.
 *
 * Stripe prices are immutable. An old quantity of 4 meant "3 + 1 paid extra";
 * on V2 that same entitlement is quantity 6 ("5 + 1 paid extra"). Keeping the
 * paid-extra count stable avoids both surprise charges and lost inbox slots.
 */
async function migrateMonthlySubscriptionPrice(sub: Stripe.Subscription): Promise<Stripe.Subscription> {
  const item = sub.items.data[0];
  if (!item || isAiSubscription(sub)) return sub;
  const prices = await ensurePrices();
  if (item.price.id === prices.monthly || item.price.id === prices.yearly) return sub;

  const oldQuantity = item.quantity ?? LEGACY_MONTHLY_INCLUDED;
  const paidExtras = Math.max(0, oldQuantity - LEGACY_MONTHLY_INCLUDED);
  const quantity = Math.min(PRICING.monthlyIncluded + paidExtras, PRICING.monthlyHardCap);
  const updated = await stripe().subscriptions.update(sub.id, {
    items: [{ id: item.id, price: prices.monthly, quantity }],
    // The two tier structures produce the same total for the preserved number
    // of paid extras, so there is no reason to generate a mid-cycle invoice.
    proration_behavior: "none",
    metadata: { ...sub.metadata, pricing_version: "monthly_v2_5_included" },
  });
  logger.info(
    { subId: sub.id, fromPrice: item.price.id, toPrice: prices.monthly, oldQuantity, quantity },
    "monthly subscription migrated to 5-included pricing",
  );
  return updated;
}

/** Excess inboxes after a downgrade get disabled (never deleted): newest
 *  first, so the longest-connected inboxes keep working. */
async function enforceInboxCap(uid: string, max: number): Promise<void> {
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("id, status, created_at")
    .eq("owner_id", uid)
    .neq("status", "disabled")
    .order("created_at", { ascending: true });
  const excess = (accounts ?? []).slice(max);
  if (excess.length === 0) return;
  await supabase
    .from("email_accounts")
    .update({
      status: "disabled",
      last_error: "Disabled after a plan change. Re-enable inboxes up to your plan limit in Settings.",
    })
    .in("id", excess.map((a) => a.id));
  logger.info({ uid, disabled: excess.length, max }, "inbox cap enforced after plan change");
}

/** Flip the profile to Lifetime after a paid one-time checkout. */
async function applyLifetime(uid: string, sessionId: string): Promise<void> {
  // Lifetime supersedes Monthly: cancel any tracked subscription (best effort).
  const { data: prof } = await supabase
    .from("profiles")
    .select("stripe_subscription_id, plan")
    .eq("user_id", uid)
    .maybeSingle();
  if (prof?.stripe_subscription_id) {
    try {
      await stripe().subscriptions.cancel(prof.stripe_subscription_id);
    } catch (err) {
      logger.warn({ err, uid }, "could not cancel monthly sub after lifetime purchase");
    }
  }
  await supabase
    .from("profiles")
    .update({
      plan: "lifetime",
      subscription_status: null,
      stripe_subscription_id: null,
      stripe_price_id: priceIds?.lifetime ?? env.STRIPE_PRICE_LIFETIME ?? null,
    })
    .eq("user_id", uid);
  await supabase.from("billing_events").insert({
    user_id: uid,
    event_type: "lifetime.purchased",
    stripe_id: sessionId,
    detail: { price_id: priceIds?.lifetime ?? null },
  });
  logger.info({ uid }, "lifetime applied to profile");
}

/**
 * Flip the profile to match a subscription's state. Idempotent — safe to call
 * from both /confirm and the webhook, in any order, multiple times.
 */
export async function applySubscription(uid: string, sub: Stripe.Subscription): Promise<void> {
  const item = sub.items.data[0];
  const priceId = item?.price.id ?? null;
  const quantity = item?.quantity ?? PRICING.monthlyIncluded;
  const isActive = ACTIVE_STATUSES.has(sub.status);

  const { data: prof } = await supabase
    .from("profiles")
    .select("stripe_subscription_id, plan")
    .eq("user_id", uid)
    .maybeSingle();

  // Lifetime is forever: a subscription event (e.g. the old Monthly getting
  // cancelled after upgrade) must never downgrade a lifetime profile.
  if (prof?.plan === "lifetime") {
    logger.info({ uid, subId: sub.id }, "ignoring subscription event for lifetime profile");
    return;
  }

  // A dead subscription may only downgrade the profile if it IS the tracked
  // subscription — otherwise a stale/out-of-order event for an old sub would
  // yank the plan from under a paying user's current one.
  if (!isActive && prof?.stripe_subscription_id && prof.stripe_subscription_id !== sub.id) {
    logger.info(
      { uid, subId: sub.id, tracked: prof.stripe_subscription_id },
      "ignoring inactive event for untracked subscription",
    );
    return;
  }

  const planId: PlanId = isActive
    ? item?.price.recurring?.interval === "year"
      ? "yearly"
      : "monthly"
    : "trial";
  // A subscription set to cancel keeps status "trialing"/"active" until the
  // period actually ends, so status alone cannot tell a happy user from one
  // already on the way out. Stored separately so churn is visible the day it
  // is requested, not the day it takes effect.
  //
  // current_period_end lives on the subscription ITEM in current Stripe API
  // versions (it was removed from the subscription object), which is why this
  // reads item first. cancel_at is the authoritative date when one is set.
  // Always stored, cancelling or not: for a live subscription it is the renewal
  // date, for a cancelling one it is the day access stops. cancel_at wins when
  // Stripe has scheduled a specific end that is not the period boundary.
  const periodEnd = sub.cancel_at ?? item?.current_period_end ?? null;
  await supabase
    .from("profiles")
    .update({
      plan: planId,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      subscription_status: sub.status,
      monthly_quantity: isActive ? quantity : 0,
      cancel_at_period_end: sub.cancel_at_period_end === true,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      billing_synced_at: new Date().toISOString(),
    })
    .eq("user_id", uid);

  await enforceInboxCap(
    uid,
    isActive
      ? planId === "yearly"
        ? Math.min(PRICING.yearlyMax, Math.max(PRICING.monthlyIncluded, quantity))
        : Math.max(PRICING.monthlyIncluded, quantity)
      : PRICING.trialMax,
  );

  await supabase.from("billing_events").insert({
    user_id: uid,
    event_type: `subscription.${sub.status}`,
    stripe_id: sub.id,
    detail: { price_id: priceId, plan: planId, quantity },
  });

  logger.info({ uid, status: sub.status, priceId, planId, quantity }, "subscription applied to profile");
}

/** Verify a Checkout session the user just returned from, and apply it. */
export async function confirmCheckout(
  uid: string,
  sessionId: string,
): Promise<{ ok: boolean; status: string }> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });
  if (session.metadata?.user_id !== uid) {
    throw new Error("This checkout doesn't belong to your account.");
  }

  if (session.mode === "payment") {
    // Lifetime purchase.
    if (session.payment_status === "paid" && session.metadata?.tier === "lifetime") {
      await applyLifetime(uid, session.id);
      return { ok: true, status: "lifetime" };
    }
    return { ok: false, status: session.payment_status ?? "incomplete" };
  }

  const sub = session.subscription;
  if (!sub || typeof sub === "string") {
    return { ok: false, status: session.status ?? "incomplete" };
  }
  // The add-on's confirm path mirrors the webhook's routing: never let the
  // seat logic interpret an AI subscription.
  if (session.metadata?.addon === "ai" || isAiSubscription(sub)) {
    await applyAiSubscription(uid, sub);
    return { ok: sub.status === "trialing" || sub.status === "active", status: sub.status };
  }
  await applySubscription(uid, sub);
  return {
    ok: sub.status === "trialing" || sub.status === "active",
    status: sub.status,
  };
}

/** Stripe-hosted billing portal (cancel / change card / invoices). */
export async function createPortalSession(uid: string): Promise<string> {
  const customer = await getOrCreateCustomer(uid);
  const session = await stripe().billingPortal.sessions.create({
    customer,
    return_url: `${env.DASHBOARD_URL}/billing`,
  });
  return session.url;
}

/** Signature-verify a webhook payload (needs the RAW request body). */
export function verifyWebhook(rawBody: Buffer, signature: string): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET unset");
  return stripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.metadata?.user_id;
      if (!uid) return;
      if (session.mode === "payment") {
        if (session.payment_status === "paid" && session.metadata?.tier === "lifetime") {
          await applyLifetime(uid, session.id);
        }
        return;
      }
      const subId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!subId) return;
      const sub = await migrateMonthlySubscriptionPrice(
        await stripe().subscriptions.retrieve(subId),
      );
      // The AI add-on branches BEFORE seat handling: applySubscription would
      // read this subscription's quantity as an inbox allowance and its
      // lifetime guard would swallow the event for lifetime users, who are
      // exactly as entitled to buy the add-on.
      if (session.metadata?.addon === "ai" || isAiSubscription(sub)) {
        await applyAiSubscription(uid, sub);
        return;
      }
      await applySubscription(uid, sub);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      let uid = sub.metadata?.user_id as string | undefined;
      if (!uid) {
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const { data } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();
        uid = (data?.user_id as string | undefined) ?? undefined;
      }
      if (!uid) {
        logger.warn({ subId: sub.id, type: event.type }, "stripe webhook: no user for subscription");
        return;
      }
      // AI add-on events route to their own tiny handler, ahead of the seat
      // logic and its guards (lifetime early-return, untracked-subscription
      // skip), both of which would otherwise silently drop them.
      if (isAiSubscription(sub)) {
        await applyAiSubscription(uid, sub);
        return;
      }
      await applySubscription(uid, sub);
      return;
    }
    default:
      return; // unhandled event types are fine — we only subscribe to these
  }
}

/**
 * Re-read every tracked subscription from Stripe and re-apply it.
 *
 * Webhooks are the fast path, not the source of truth. A misconfigured
 * endpoint URL silently 404'd every billing event for three days: checkout
 * still worked (the /confirm redirect covers that), but every renewal,
 * cancellation and payment failure in that window was invisible, and nothing
 * in the system would ever have noticed. This pass closes that hole by asking
 * Stripe directly on a schedule.
 *
 * Reads Stripe, writes only through applySubscription, so all the existing
 * guards (lifetime never downgraded, untracked-subscription events ignored)
 * apply unchanged. Safe to run repeatedly.
 */
export async function reconcileBilling(): Promise<{ checked: number; changed: number; failed: number }> {
  if (!env.STRIPE_SECRET_KEY) {
    logger.info("billing reconcile skipped: STRIPE_SECRET_KEY unset");
    return { checked: 0, changed: 0, failed: 0 };
  }

  // Lifetime profiles are excluded: they have no subscription to re-read, and
  // applySubscription would refuse to touch them anyway.
  const { data: rows, error } = await supabase
    .from("profiles")
    .select("user_id, stripe_subscription_id, subscription_status, cancel_at_period_end")
    .not("stripe_subscription_id", "is", null)
    .neq("plan", "lifetime");
  if (error) {
    logger.error({ err: error }, "billing reconcile: profile query failed");
    return { checked: 0, changed: 0, failed: 0 };
  }

  let changed = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const subId = row.stripe_subscription_id as string;
    const uid = row.user_id as string;
    try {
      const sub = await migrateMonthlySubscriptionPrice(
        await stripe().subscriptions.retrieve(subId),
      );
      await applySubscription(uid, sub);
      const drifted =
        sub.status !== row.subscription_status ||
        sub.cancel_at_period_end !== (row.cancel_at_period_end === true);
      if (drifted) {
        changed += 1;
        logger.warn(
          {
            uid,
            subId,
            was: row.subscription_status,
            now: sub.status,
            cancelling: sub.cancel_at_period_end,
          },
          "billing reconcile: drift corrected (a webhook was missed)",
        );
      }
    } catch (err) {
      // A deleted subscription 404s here. Leave the profile alone rather than
      // guessing: a wrong downgrade locks out someone who is actually paying.
      failed += 1;
      logger.error({ err, uid, subId }, "billing reconcile: subscription refresh failed");
    }
  }

  // Second pass: the AI add-on subscriptions, which the seat pass excludes by
  // construction (different column, and lifetime profiles carry them too).
  const { data: aiRows, error: aiErr } = await supabase
    .from("profiles")
    .select("user_id, ai_subscription_id, ai_status")
    .not("ai_subscription_id", "is", null);
  if (aiErr) {
    logger.error({ err: aiErr }, "billing reconcile: ai profile query failed");
  }
  for (const row of aiRows ?? []) {
    const subId = row.ai_subscription_id as string;
    const uid = row.user_id as string;
    try {
      const sub = await stripe().subscriptions.retrieve(subId);
      await applyAiSubscription(uid, sub);
      if (sub.status !== row.ai_status) {
        changed += 1;
        logger.warn(
          { uid, subId, was: row.ai_status, now: sub.status },
          "billing reconcile: ai add-on drift corrected (a webhook was missed)",
        );
      }
    } catch (err) {
      failed += 1;
      logger.error({ err, uid, subId }, "billing reconcile: ai subscription refresh failed");
    }
  }

  logger.info({ checked: (rows ?? []).length, changed, failed }, "billing reconcile complete");
  return { checked: (rows ?? []).length, changed, failed };
}
