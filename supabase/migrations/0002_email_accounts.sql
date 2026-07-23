-- Connected mailboxes. credentials_enc holds the AES-256-GCM blob of the
-- IMAP/SMTP password JSON; the column is NEVER selectable by clients (column
-- grants below). All writes go through the service-role API.
create table email_accounts (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references auth.users(id) on delete cascade,
  label                text not null,
  email_address        text not null,
  color                text not null,
  provider_preset      text not null default 'custom'
    check (provider_preset in ('gmail', 'porkbun', 'custom')),
  imap_host            text not null,
  imap_port            int  not null default 993,
  smtp_host            text not null,
  smtp_port            int  not null default 465,
  smtp_security        text not null default 'tls'
    check (smtp_security in ('tls', 'starttls')),
  imap_username        text not null,
  credentials_enc      text not null,
  status               text not null default 'active'
    check (status in ('active', 'auth_failed', 'disabled')),
  last_error           text,
  consecutive_failures int  not null default 0,
  next_sync_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  unique (owner_id, email_address)
);
create index email_accounts_due_idx on email_accounts (status, next_sync_at);

alter table email_accounts enable row level security;
create policy "owner read accounts" on email_accounts
  for select to authenticated using (owner_id = auth.uid());

-- Column-level grant: strip credentials_enc (and sync bookkeeping) from what
-- authenticated clients can select, even through the RLS policy above.
revoke select on table email_accounts from authenticated, anon;
grant select (id, owner_id, label, email_address, color, provider_preset,
              status, last_error, created_at)
  on table email_accounts to authenticated;

-- Per-account IMAP sync cursor. Service-role only: RLS on, zero policies.
create table sync_state (
  account_id        uuid primary key references email_accounts(id) on delete cascade,
  mailbox           text not null default 'INBOX',
  uid_validity      bigint,
  last_seen_uid     bigint not null default 0,
  last_full_sync_at timestamptz,
  last_sync_at      timestamptz,
  updated_at        timestamptz not null default now()
);
alter table sync_state enable row level security;
