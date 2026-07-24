-- Pricing model change: one Monthly plan ($5/month, 3 accounts included,
-- +$2/month per extra) plus a $50 one-time Lifetime plan (10 accounts).
-- profiles.plan now takes 'trial' | 'monthly' | 'lifetime'.
-- monthly_quantity mirrors the Stripe subscription quantity (allowed
-- accounts on Monthly, always >= 3 while subscribed).
alter table uni_inbox.profiles
  add column if not exists monthly_quantity int not null default 0;

-- Existing rows on the old tier ids (solo/builder/empire) would be strays;
-- map any to monthly with their old allowance as the quantity.
update uni_inbox.profiles set plan = 'monthly', monthly_quantity = 3  where plan = 'solo';
update uni_inbox.profiles set plan = 'monthly', monthly_quantity = 5  where plan = 'builder';
update uni_inbox.profiles set plan = 'monthly', monthly_quantity = 12 where plan = 'empire';
