-- Trial shortened from 14 days to 3 (Ross, 2026-07-24). Card-less and
-- app-side as before; only the profiles default changes, so this applies
-- to new signups. Existing trial users keep their original end date.
alter table uni_inbox.profiles
  alter column trial_ends_at set default now() + interval '3 days';
