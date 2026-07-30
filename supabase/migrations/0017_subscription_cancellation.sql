-- Track pending cancellation and the paid-through date on the profile.
--
-- Why this was missing and why it matters: cancelling a Stripe subscription at
-- period end fires customer.subscription.updated with cancel_at_period_end
-- true, while `status` stays "trialing" or "active". We only stored `status`,
-- so a user who had already asked to leave was indistinguishable from a happy
-- one right up until the day they vanished. The founder analytics page cannot
-- show churn it cannot see.
--
-- current_period_end is stored as a real timestamp so "paid through" and
-- "cancels on" can be read straight out of Postgres. Note it comes from the
-- subscription ITEM in current Stripe API versions, not the subscription.

alter table uni_inbox.profiles
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists current_period_end timestamptz;

comment on column uni_inbox.profiles.cancel_at_period_end is
  'Stripe cancel_at_period_end: user has asked to leave, access runs to current_period_end.';
comment on column uni_inbox.profiles.current_period_end is
  'End of the paid period from the Stripe subscription item. Access date when cancelling.';

-- Last time this profile's billing was written from Stripe's own data, by
-- either path: a webhook or the daily reconcile. Set in applySubscription, so
-- it covers both by construction.
--
-- What it detects is the reconcile job dying, not webhooks dying: with the
-- daily pass running, this stays under a day old even if every webhook 404s.
-- Webhook failure shows up instead as the reconcile logging corrected drift,
-- which is the signal a three-day outage would have tripped on day one.
alter table uni_inbox.profiles
  add column if not exists billing_synced_at timestamptz;

comment on column uni_inbox.profiles.billing_synced_at is
  'Last write of billing state from Stripe data, via webhook or the daily reconcile.';
