-- Billing audit trail (optional but cheap): one row per Stripe event we acted
-- on, for debugging subscription state disputes. Service-role only.
create table billing_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  event_type  text not null,
  stripe_id   text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index billing_events_user_idx on billing_events (user_id, created_at desc);
alter table billing_events enable row level security;

-- Daily send counter for the per-user send cap (no Redis; plain Postgres).
create table send_counters (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day      date not null,
  sent     int  not null default 0,
  primary key (user_id, day)
);
alter table send_counters enable row level security;

-- Retention helper: drop threads whose messages have all been swept.
create or replace function public.delete_empty_threads()
returns int language plpgsql security definer set search_path = '' as $$
declare removed int;
begin
  delete from public.threads t
  where not exists (select 1 from public.messages m where m.thread_id = t.id);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create or replace function public.bump_send_counter(p_user_id uuid, p_day date, p_max int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare new_count int;
begin
  insert into public.send_counters (user_id, day, sent)
  values (p_user_id, p_day, 1)
  on conflict (user_id, day) do update
    set sent = public.send_counters.sent + 1
    where public.send_counters.sent < p_max
  returning sent into new_count;
  return new_count is not null;
end;
$$;
