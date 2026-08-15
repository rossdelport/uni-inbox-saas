-- Delete and Restore must feel immediate, but IMAP folder moves can take
-- several seconds. Keep the user's requested destination in a durable queue
-- so the HTTP request can return as soon as the local thread changes piles.
-- The worker retries provider moves until they succeed; a deploy or dropped
-- IMAP connection therefore cannot lose the user's action.
create table uni_inbox.mailbox_move_ops (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete cascade,
  account_id          uuid not null references uni_inbox.email_accounts(id) on delete cascade,
  thread_id           uuid not null references uni_inbox.threads(id) on delete cascade,
  destination         text not null check (destination in ('trash', 'inbox')),
  generation          uuid not null default gen_random_uuid(),
  status              text not null default 'queued' check (status in ('queued', 'processing')),
  attempts            int not null default 0,
  not_before          timestamptz not null default now(),
  claimed_at          timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (thread_id)
);

create index mailbox_move_ops_ready_idx
  on uni_inbox.mailbox_move_ops (status, not_before, created_at);

-- Service-role only. The browser sees the resulting thread state through the
-- existing owner-scoped inbox API; it never needs direct queue access.
alter table uni_inbox.mailbox_move_ops enable row level security;
revoke all on table uni_inbox.mailbox_move_ops from anon, authenticated;
grant select, insert, update, delete on table uni_inbox.mailbox_move_ops to service_role;
