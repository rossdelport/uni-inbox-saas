import Stripe from "stripe";
import { env } from "../config/env.js";

// Idempotent Stripe setup: one product, three prices. Run once against TEST,
// once against LIVE (whichever key is in env):
//   npm run stripe:setup --workspace @uni/api
// Prints the price ids to paste into env as STRIPE_PRICE_MONTHLY_V2,
// STRIPE_PRICE_YEARLY and STRIPE_PRICE_LIFETIME.
//
// Monthly is a graduated-tier price where the subscription QUANTITY is the
// number of allowed accounts: the first 5 bill a flat $10/month, every extra
// account $2/month. Yearly uses the same seat model at a 20% discount from
// the $10 base. Lifetime is a $97 one-time price (10 accounts, enforced in
// the app).

async function main() {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY unset");
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const mode = env.STRIPE_SECRET_KEY.startsWith("sk_live") ? "LIVE" : "TEST";
  console.log(`Stripe mode: ${mode}`);

  // Product (find by name, create if missing).
  const products = await stripe.products.search({ query: `name:"OneInbox" AND active:"true"` });
  const product =
    products.data[0] ??
    (await stripe.products.create({
      name: "OneInbox",
      description: "All your project inboxes in one clutter-free place.",
    }));
  console.log(`Product: ${product.id}`);

  // Monthly: graduated tiers, quantity = allowed accounts.
  const monthlyExisting = await stripe.prices.list({
    lookup_keys: ["oneinbox_monthly_v3"],
    active: true,
    limit: 1,
  });
  const monthly =
    monthlyExisting.data[0] ??
    (await stripe.prices.create({
      product: product.id,
      currency: "usd",
      nickname: "Monthly (5 included, $2 per extra account)",
      lookup_key: "oneinbox_monthly_v3",
      recurring: { interval: "month" },
      billing_scheme: "tiered",
      tiers_mode: "graduated",
      tiers: [
        { up_to: 5, flat_amount: 1000, unit_amount: 0 },
        { up_to: "inf", unit_amount: 200 },
      ],
    }));
  console.log(`STRIPE_PRICE_MONTHLY_V2=${monthly.id}`);

  const yearlyExisting = await stripe.prices.list({
    lookup_keys: ["oneinbox_yearly_v1"],
    active: true,
    limit: 1,
  });
  const yearly =
    yearlyExisting.data[0] ??
    (await stripe.prices.create({
      product: product.id,
      currency: "usd",
      nickname: "Yearly (5 included, 20% off)",
      lookup_key: "oneinbox_yearly_v1",
      recurring: { interval: "year" },
      billing_scheme: "tiered",
      tiers_mode: "graduated",
      tiers: [
        { up_to: 5, flat_amount: 9700, unit_amount: 0 },
        { up_to: "inf", unit_amount: 1920 },
      ],
    }));
  console.log(`STRIPE_PRICE_YEARLY=${yearly.id}`);

  // Lifetime: $50 one-time.
  const lifetimeExisting = await stripe.prices.list({
    lookup_keys: ["oneinbox_lifetime_v2"],
    active: true,
    limit: 1,
  });
  const lifetime =
    lifetimeExisting.data[0] ??
    (await stripe.prices.create({
      product: product.id,
      currency: "usd",
      nickname: "Lifetime (10 accounts, one-time)",
      lookup_key: "oneinbox_lifetime_v2",
      unit_amount: 9700,
    }));
  console.log(`STRIPE_PRICE_LIFETIME=${lifetime.id}`);

  console.log("\nPaste the three price ids above into .env (dev) and Railway (prod).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
