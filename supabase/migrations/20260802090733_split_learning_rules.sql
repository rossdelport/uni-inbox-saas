-- Split Inbox learning: let a user correct a thread and optionally remember
-- that choice for the sender or domain. The classifier remains conservative;
-- a saved rule is the only thing that can override its Important fallback.

alter table uni_inbox.threads
  add column if not exists split_manual boolean not null default false,
  add column if not exists split_reason text;

-- Existing rows predate explanations. Give them a safe, human-readable reason
-- without pretending that old rows had a confidence score we never stored.
update uni_inbox.threads
   set split_reason = case split_class
     when 'newsletter' then 'Mailing-list signals'
     when 'other' then 'Automated sender signals'
     else 'No bulk or automated signals'
   end
 where split_reason is null;

-- Rules are private server-side data. The API uses the service role after it
-- has checked the authenticated owner, so clients never need direct table
-- access. account_id scopes a rule to the mailbox where the user created it;
-- this avoids unexpectedly moving the same sender in a different mailbox.
create table if not exists uni_inbox.split_rules (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  account_id  uuid not null references uni_inbox.email_accounts(id) on delete cascade,
  match_kind  text not null check (match_kind in ('sender', 'domain')),
  match_value text not null,
  split_class text not null check (split_class in ('important', 'newsletter', 'other')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists split_rules_lookup_idx
  on uni_inbox.split_rules (owner_id, account_id, match_kind, match_value);

alter table uni_inbox.split_rules enable row level security;
revoke all on table uni_inbox.split_rules from public, anon, authenticated;
grant all on table uni_inbox.split_rules to service_role;
