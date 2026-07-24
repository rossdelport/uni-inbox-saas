import Stripe from "stripe";
import { env } from "../config/env.js";

// Idempotent Stripe setup: one product, two prices. Run once against TEST,
// once against LIVE (whichever key is in env):
//   npm run stripe:setup --workspace @uni/api
// Prints the price ids to paste into env as STRIPE_PRICE_MONTHLY / _LIFETIME.
//
// Monthly is a graduated-tier price where the subscription QUANTITY is the
// number of allowed accounts: the first 3 bill a flat $5/month, every extra
// account $2/month. Lifetime is a $50 one-time price (10 accounts, enforced
// in the app).

async function main() {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY unset");
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const mode = env.STRIPE_SECRET_KEY.startsWith("sk_live") ? "LIVE" : "TEST";
  console.log(`Stripe mode: ${mode}`);

  // Product (find by name, create if missing).
  const products = await stripe.products.search({ query: `name:"Uni-Inbox" AND active:"true"` });
  const product =
    products.data[0] ??
    (await stripe.products.create({
      name: "Uni-Inbox",
      description: "All your project inboxes in one clutter-free place.",
    }));
  console.log(`Product: ${product.id}`);

  // Monthly: graduated tiers, quantity = allowed accounts.
  const monthlyExisting = await stripe.prices.list({
    lookup_keys: ["uni_monthly"],
    active: true,
    limit: 1,
  });
  const monthly =
    monthlyExisting.data[0] ??
    (await stripe.prices.create({
      product: product.id,
      currency: "usd",
      nickname: "Monthly (3 included, $2 per extra account)",
      lookup_key: "uni_monthly",
      recurring: { interval: "month" },
      billing_scheme: "tiered",
      tiers_mode: "graduated",
      tiers: [
        { up_to: 3, flat_amount: 500, unit_amount: 0 },
        { up_to: "inf", unit_amount: 200 },
      ],
    }));
  console.log(`STRIPE_PRICE_MONTHLY=${monthly.id}`);

  // Lifetime: $50 one-time.
  const lifetimeExisting = await stripe.prices.list({
    lookup_keys: ["uni_lifetime"],
    active: true,
    limit: 1,
  });
  const lifetime =
    lifetimeExisting.data[0] ??
    (await stripe.prices.create({
      product: product.id,
      currency: "usd",
      nickname: "Lifetime (10 accounts, one-time)",
      lookup_key: "uni_lifetime",
      unit_amount: 5000,
    }));
  console.log(`STRIPE_PRICE_LIFETIME=${lifetime.id}`);

  console.log("\nPaste the two price ids above into .env (dev) and Railway (prod).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
