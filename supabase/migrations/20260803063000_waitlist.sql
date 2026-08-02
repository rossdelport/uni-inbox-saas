-- Public waitlist records are written only by the API service role. The
-- marketing page never receives a database key and no browser role can query
-- another person's email address or attribution data.
create table uni_inbox.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 320),
  -- First CTA that led to the signup. Keep this immutable so funnel reporting
  -- reflects the original conversion point.
  source text not null default 'unknown' check (char_length(source) between 1 and 100),
  -- The latest CTA is useful when someone returns and joins through a second
  -- section, without losing their original source.
  last_source text not null default 'unknown' check (char_length(last_source) between 1 and 100),
  page_path text not null default '/lpwaitlist' check (char_length(page_path) between 1 and 200),
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  -- This token is returned only to the browser that just joined and lets the
  -- thank-you page attach optional feedback without exposing the signups table.
  feedback_token uuid not null default gen_random_uuid(),
  promo_code text,
  email_sent_at timestamptz,
  signup_count integer not null default 1 check (signup_count >= 1),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index waitlist_signups_email_lower_key
  on uni_inbox.waitlist_signups (lower(email));
create unique index waitlist_signups_feedback_token_key
  on uni_inbox.waitlist_signups (feedback_token);
create index waitlist_signups_created_at_idx
  on uni_inbox.waitlist_signups (created_at desc);
create index waitlist_signups_source_idx
  on uni_inbox.waitlist_signups (source, created_at desc);

create table uni_inbox.waitlist_feedback (
  id uuid primary key default gen_random_uuid(),
  waitlist_signup_id uuid not null references uni_inbox.waitlist_signups(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index waitlist_feedback_signup_created_idx
  on uni_inbox.waitlist_feedback (waitlist_signup_id, created_at desc);

alter table uni_inbox.waitlist_signups enable row level security;
alter table uni_inbox.waitlist_feedback enable row level security;

-- These tables live in an exposed schema, so explicitly deny direct browser
-- access even if this Supabase project still has historical default grants.
revoke all on table uni_inbox.waitlist_signups from public, anon, authenticated;
revoke all on table uni_inbox.waitlist_feedback from public, anon, authenticated;
grant select, insert, update, delete on table uni_inbox.waitlist_signups to service_role;
grant select, insert, update, delete on table uni_inbox.waitlist_feedback to service_role;
