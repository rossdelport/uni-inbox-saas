-- Per-user profile with plan + Stripe billing state. Auto-created on signup.
-- Plan gating: trial (14 days, card-less) -> solo/builder/empire via Stripe.
-- Billing columns are written ONLY by the service role; owners read their row.
create table profiles (
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
create index profiles_stripe_customer_idx on profiles (stripe_customer_id);

alter table profiles enable row level security;
create policy "owner read profile" on profiles
  for select to authenticated using (user_id = auth.uid());

-- Clients may update only display_name on their own row; plan/billing stay
-- service-role-only via column-level grants.
create policy "owner update profile" on profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on table profiles from authenticated, anon;
grant update (display_name) on table profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (user_id)
  select id from auth.users on conflict (user_id) do nothing;
