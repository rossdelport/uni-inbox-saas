import Stripe from "stripe";
import type { PlanId } from "@uni/shared";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { PLANS } from "../lib/plans.js";

// Stripe billing core. One product ("Uni-Inbox"), three recurring prices:
// solo $5/mo (2 inboxes), builder $10/mo (5), empire $20/mo (12).
// The 14-day trial is card-less and app-side (profiles.trial_ends_at), so
// Checkout carries NO Stripe trial — one trial system, not two.
// The plan flip happens in TWO places on purpose: the authenticated /confirm
// call when the user lands back from Checkout (instant UX) and the webhook
// (renewals, cancellations, and the backstop if the redirect never happens).

let client: Stripe | undefined;
function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Billing isn't configured (STRIPE_SECRET_KEY unset).");
  if (!client) client = new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

export type CheckoutTier = "solo" | "builder" | "empire";

// Subscription statuses that count as "paying" (past_due keeps access during
// the retry window rather than yanking the account on one failed card).
const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

function priceFor(tier: CheckoutTier): string {
  const price = {
    solo: env.STRIPE_PRICE_SOLO,
    builder: env.STRIPE_PRICE_BUILDER,
    empire: env.STRIPE_PRICE_EMPIRE,
  }[tier];
  if (!price) throw new Error(`Billing price for ${tier} not configured.`);
  return price;
}

function planForPrice(priceId: string | null): PlanId {
  if (priceId === env.STRIPE_PRICE_SOLO) return "solo";
  if (priceId === env.STRIPE_PRICE_BUILDER) return "builder";
  if (priceId === env.STRIPE_PRICE_EMPIRE) return "empire";
  return "solo"; // unknown price on an active sub: least-generous paid tier
}

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
  await supabase
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("user_id", uid);
  return customer.id;
}

/** Create the Checkout session and return its URL. */
export async function createCheckoutSession(uid: string, tier: CheckoutTier): Promise<string> {
  // Guard: one live subscription per account. Without this, a retried confirm
  // or a double-submitted form could stack two real subscriptions. Upgrades /
  // downgrades go through the Stripe portal instead.
  const { data: prof } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("user_id", uid)
    .maybeSingle();
  if (ACTIVE_STATUSES.has(prof?.subscription_status ?? "")) {
    throw new Error("You already have an active subscription. Manage it in Settings, Plan and Billing.");
  }
  const customer = await getOrCreateCustomer(uid);
  const base = env.DASHBOARD_URL;

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: priceFor(tier), quantity: 1 }],
    subscription_data: { metadata: { user_id: uid } },
    metadata: { user_id: uid },
    allow_promotion_codes: true,
    success_url: `${base}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/billing?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL.");
  return session.url;
}

/** Excess inboxes after a downgrade get disabled (never deleted): newest
 *  first, so the longest-connected inboxes keep working. */
async function enforceInboxCap(uid: string, planId: PlanId): Promise<void> {
  const max = PLANS[planId].maxInboxes;
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
  logger.info({ uid, disabled: excess.length, planId }, "inbox cap enforced after plan change");
}

/**
 * Flip the profile to match a subscription's state. Idempotent — safe to call
 * from both /confirm and the webhook, in any order, multiple times.
 */
export async function applySubscription(uid: string, sub: Stripe.Subscription): Promise<void> {
  const priceId = sub.items.data[0]?.price.id ?? null;
  const isActive = ACTIVE_STATUSES.has(sub.status);

  // A dead subscription may only downgrade the profile if it IS the tracked
  // subscription — otherwise a stale/out-of-order event for an old sub would
  // yank the plan from under a paying user's current one.
  if (!isActive) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("stripe_subscription_id")
      .eq("user_id", uid)
      .maybeSingle();
    if (prof?.stripe_subscription_id && prof.stripe_subscription_id !== sub.id) {
      logger.info(
        { uid, subId: sub.id, tracked: prof.stripe_subscription_id },
        "ignoring inactive event for untracked subscription",
      );
      return;
    }
  }

  const planId: PlanId = isActive ? planForPrice(priceId) : "trial";
  await supabase
    .from("profiles")
    .update({
      plan: planId,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      subscription_status: sub.status,
    })
    .eq("user_id", uid);

  await enforceInboxCap(uid, planId);

  await supabase.from("billing_events").insert({
    user_id: uid,
    event_type: `subscription.${sub.status}`,
    stripe_id: sub.id,
    detail: { price_id: priceId, plan: planId },
  });

  logger.info({ uid, status: sub.status, priceId, planId }, "subscription applied to profile");
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

/** Stripe-hosted billing portal (cancel / change plan / change card). */
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
      const subId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!uid || !subId) return;
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
