-- First-party marketing analytics: one row per page view, no cookies, no
-- user identifiers. Service-role only (RLS on, no policies).
create table uni_inbox.page_views (
  id         bigint generated always as identity primary key,
  path       text not null,
  referrer   text,
  ua         text,
  created_at timestamptz not null default now()
);
create index page_views_created_idx on uni_inbox.page_views (created_at);
alter table uni_inbox.page_views enable row level security;
