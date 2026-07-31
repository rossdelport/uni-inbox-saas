-- AI thread summaries, sold as an opt-in $3/month add-on.
--
-- Three pieces:
--   ai_summaries  = the cache. A summary is a pure function of the thread's
--                   messages, so it is stored keyed by thread and considered
--                   fresh while (last_message_at, message_count) match the
--                   thread. Re-opening a thread costs zero API calls.
--   ai_usage      = per-user per-day counter behind an atomic reserve
--                   function. The cap exists to bound a runaway client's
--                   spend, not to ration normal use.
--   profiles.ai_* = the add-on's Stripe state. A SEPARATE subscription, not a
--                   second item on the seat subscription: four money-handling
--                   call sites treat items.data[0] as the seat item, and a
--                   second item would let the add-on disable a paying user's
--                   mailboxes through enforceInboxCap.

create table if not exists uni_inbox.ai_summaries (
  thread_id uuid primary key references uni_inbox.threads(id) on delete cascade,
  owner_id uuid not null,
  summary text not null,
  model text not null,
  -- Freshness key: the thread state this summary was computed from.
  thread_last_message_at timestamptz not null,
  message_count int not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);

alter table uni_inbox.ai_summaries enable row level security;
create policy ai_summaries_owner_select on uni_inbox.ai_summaries
  for select using (auth.uid() = owner_id);
-- RLS alone is not enough: without the table grant every query 42501s.
-- (0015_threads_realtime_grant.sql is the writeup of learning this once.)
grant select on uni_inbox.ai_summaries to authenticated;

create table if not exists uni_inbox.ai_usage (
  owner_id uuid not null,
  day date not null,
  used int not null default 0,
  primary key (owner_id, day)
);
-- Service role only: RLS on, no policies, no grants.
alter table uni_inbox.ai_usage enable row level security;

-- Atomic reserve-before-call. Returns true when a slot was taken, false at
-- the cap. FOUND covers both paths: the fresh insert and the guarded update.
create or replace function uni_inbox.bump_ai_counter(p_owner uuid, p_cap int)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into uni_inbox.ai_usage as u (owner_id, day, used)
  values (p_owner, current_date, 1)
  on conflict (owner_id, day) do update set used = u.used + 1
  where u.used < p_cap;
  return found;
end $$;

-- The refund for a reserve whose API call then failed: the user should not
-- burn cap on our errors.
create or replace function uni_inbox.refund_ai_counter(p_owner uuid)
returns void
language sql volatile security definer set search_path = '' as $$
  update uni_inbox.ai_usage
     set used = greatest(used - 1, 0)
   where owner_id = p_owner and day = current_date;
$$;

revoke all on function uni_inbox.bump_ai_counter(uuid, int) from public, anon, authenticated;
revoke all on function uni_inbox.refund_ai_counter(uuid) from public, anon, authenticated;
grant execute on function uni_inbox.bump_ai_counter(uuid, int) to service_role;
grant execute on function uni_inbox.refund_ai_counter(uuid) to service_role;

-- The add-on's Stripe mirror on the profile.
alter table uni_inbox.profiles
  add column if not exists ai_subscription_id text,
  add column if not exists ai_status text;

comment on column uni_inbox.profiles.ai_status is
  'Stripe status of the AI add-on subscription (active/trialing/canceled/...). Null = never subscribed.';
