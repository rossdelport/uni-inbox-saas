import Stripe from "stripe";
import type { PlanId } from "@uni/shared";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { getBilling, PRICING } from "../lib/plans.js";

// Stripe billing core. One product ("Uni-Inbox"), two prices:
//  - Monthly (STRIPE_PRICE_MONTHLY): recurring, graduated tiers — quantity is
//    the number of allowed accounts; first 3 bill a flat $5, each extra $2.
//  - Lifetime (STRIPE_PRICE_LIFETIME): $50 one-time payment, 10 accounts.
// The 14-day trial is card-less and app-side (profiles.trial_ends_at).
// Plan flips happen in TWO places on purpose: the authenticated /confirm call
// when the user lands back from Checkout (instant UX) and the webhook
// (renewals, cancellations, and the backstop if the redirect never happens).

let client: Stripe | undefined;
function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Billing isn't configured (STRIPE_SECRET_KEY unset).");
  if (!client) client = new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

export type CheckoutTier = "monthly" | "lifetime";

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

/** Create the Checkout session and return its URL. */
export async function createCheckoutSession(uid: string, tier: CheckoutTier): Promise<string> {
  const billing = await getBilling(uid);
  if (billing.planId === "lifetime") {
    throw new Error("You already have Lifetime. There is nothing above it.");
  }
  const customer = await getOrCreateCustomer(uid);
  const base = env.DASHBOARD_URL;

  if (tier === "lifetime") {
    if (!env.STRIPE_PRICE_LIFETIME) throw new Error("Lifetime price not configured.");
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer,
      line_items: [{ price: env.STRIPE_PRICE_LIFETIME, quantity: 1 }],
      metadata: { user_id: uid, tier: "lifetime" },
      allow_promotion_codes: true,
      success_url: `${base}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?checkout=cancelled`,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL.");
    return session.url;
  }

  // Monthly. Guard: one live subscription per account — a retried confirm or
  // double-submitted form must not stack two subscriptions. Seat changes go
  // through /add-seat, cancel through the portal.
  if (ACTIVE_STATUSES.has(billing.subscriptionStatus ?? "")) {
    throw new Error("You already have an active subscription. Manage it in Settings, Plan and Billing.");
  }
  if (!env.STRIPE_PRICE_MONTHLY) throw new Error("Monthly price not configured.");

  // Start with enough seats for what's already connected (>= 3).
  const { count } = await supabase
    .from("email_accounts")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", uid)
    .neq("status", "disabled");
  const quantity = Math.min(
    Math.max(PRICING.monthlyIncluded, count ?? 0),
    PRICING.monthlyHardCap,
  );

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: env.STRIPE_PRICE_MONTHLY, quantity }],
    subscription_data: { metadata: { user_id: uid } },
    metadata: { user_id: uid, tier: "monthly" },
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
  if (billing.planId !== "monthly" || !ACTIVE_STATUSES.has(billing.subscriptionStatus ?? "")) {
    throw new Error("Adding a seat needs an active Monthly subscription.");
  }
  const { data: prof } = await supabase
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("user_id", uid)
    .maybeSingle();
  const subId = prof?.stripe_subscription_id as string | null;
  if (!subId) throw new Error("No subscription on file. Contact support.");

  const sub = await stripe().subscriptions.retrieve(subId);
  const item = sub.items.data[0];
  if (!item) throw new Error("Subscription has no items. Contact support.");
  const current = item.quantity ?? PRICING.monthlyIncluded;
  const quantity = Math.min(current + 1, PRICING.monthlyHardCap);
  if (quantity === current) throw new Error("Seat limit reached. Contact support for more.");

  const updated = await stripe().subscriptions.update(subId, {
    items: [{ id: item.id, quantity }],
    proration_behavior: "create_prorations",
  });
  await applySubscription(uid, updated);
  return { quantity };
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
      stripe_price_id: env.STRIPE_PRICE_LIFETIME ?? null,
    })
    .eq("user_id", uid);
  await supabase.from("billing_events").insert({
    user_id: uid,
    event_type: "lifetime.purchased",
    stripe_id: sessionId,
    detail: { price_id: env.STRIPE_PRICE_LIFETIME },
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

  const planId: PlanId = isActive ? "monthly" : "trial";
  await supabase
    .from("profiles")
    .update({
      plan: planId,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      subscription_status: sub.status,
      monthly_quantity: isActive ? quantity : 0,
    })
    .eq("user_id", uid);

  await enforceInboxCap(uid, isActive ? Math.max(PRICING.monthlyIncluded, quantity) : PRICING.trialMax);

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
      const sub = await stripe().subscriptions.retrieve(subId);
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
      await applySubscription(uid, sub);
      return;
    }
    default:
      return; // unhandled event types are fine — we only subscribe to these
  }
}
