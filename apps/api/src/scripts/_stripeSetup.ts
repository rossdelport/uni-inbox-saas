import Stripe from "stripe";
import { env } from "../config/env.js";

// Idempotent Stripe setup: one product, three monthly prices with lookup
// keys. Run once against TEST, once against LIVE (whichever key is in env):
//   npm run stripe:setup --workspace @uni/api
// Prints the price ids to paste into env as STRIPE_PRICE_SOLO/BUILDER/EMPIRE.

const TIERS = [
  { lookup: "uni_solo_monthly", nickname: "Solo", amount: 500, envVar: "STRIPE_PRICE_SOLO" },
  { lookup: "uni_builder_monthly", nickname: "Builder", amount: 1000, envVar: "STRIPE_PRICE_BUILDER" },
  { lookup: "uni_empire_monthly", nickname: "Empire", amount: 2000, envVar: "STRIPE_PRICE_EMPIRE" },
] as const;

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

  for (const tier of TIERS) {
    const existing = await stripe.prices.list({
      lookup_keys: [tier.lookup],
      active: true,
      limit: 1,
    });
    const price =
      existing.data[0] ??
      (await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: tier.amount,
        recurring: { interval: "month" },
        nickname: tier.nickname,
        lookup_key: tier.lookup,
      }));
    console.log(`${tier.envVar}=${price.id}`);
  }
  console.log("\nPaste the three price ids above into .env (dev) and Railway (prod).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
