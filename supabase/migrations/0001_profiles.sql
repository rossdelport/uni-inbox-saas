-- Uni-Inbox lives in its own schema inside a SHARED Supabase project
-- (currently the ibookshelf project). Everything is namespaced under
-- uni_inbox so the two products never collide. Moving to a dedicated project
-- later = dump/restore this schema and repoint SUPABASE_URL.
--
-- IMPORTANT (dashboard step, not SQL): add "uni_inbox" to Settings -> API ->
-- Exposed schemas, or PostgREST (and therefore the whole API) can't see it.
create schema if not exists uni_inbox;
grant usage on schema uni_inbox to anon, authenticated, service_role;
alter default privileges in schema uni_inbox grant all on tables to service_role;
alter default privileges in schema uni_inbox grant all on functions to service_role;
alter default privileges in schema uni_inbox grant all on sequences to service_role;

-- Per-user profile with plan + Stripe billing state. Auto-created on signup.
-- Plan gating: trial (14 days, card-less) -> solo/builder/empire via Stripe.
-- Billing columns are written ONLY by the service role; owners read their row.
create table uni_inbox.profiles (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  plan                   text not null default 'trial',
  display_name           text,
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_price_id        text,
  subscription_status    text,
  trial_ends_at          timestamptz not null default now() + interval '14 days',
  created_at             timestamptz not null default now()
);
create index profiles_stripe_customer_idx on uni_inbox.profiles (stripe_customer_id);

alter table uni_inbox.profiles enable row level security;
create policy "owner read profile" on uni_inbox.profiles
  for select to authenticated using (user_id = auth.uid());

-- Clients may update only display_name on their own row; plan/billing stay
-- service-role-only via column-level grants.
create policy "owner update profile" on uni_inbox.profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on table uni_inbox.profiles from authenticated, anon;
grant select on table uni_inbox.profiles to authenticated;
grant update (display_name) on table uni_inbox.profiles to authenticated;

-- Shared-project note: this trigger fires for EVERY signup in the Supabase
-- project (ibookshelf signups included). A stray uni_inbox.profiles row for an
-- ibookshelf-only user is harmless and costs nothing. Function and trigger
-- names are namespaced so they can't collide with ibookshelf's own signup
-- trigger. Deliberately NO backfill of existing users: pre-existing ibookshelf
-- accounts must not get Uni-Inbox trials.
create or replace function uni_inbox.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into uni_inbox.profiles (user_id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger uni_on_auth_user_created
  after insert on auth.users
  for each row execute function uni_inbox.handle_new_user();
