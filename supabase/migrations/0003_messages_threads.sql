-- Threads + messages for the unified inbox. Lean window: the retention sweep
-- keeps ~90 days / newest 500 per account, so these tables stay small.
create table threads (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  account_id      uuid not null references email_accounts(id) on delete cascade,
  subject_norm    text not null,
  last_message_at timestamptz not null,
  message_count   int not null default 1,
  unread          boolean not null default true,
  archived        boolean not null default false,
  snippet         text,
  created_at      timestamptz not null default now()
);
create index threads_inbox_idx on threads (owner_id, archived, last_message_at desc);
create index threads_account_idx on threads (account_id, subject_norm);

create table messages (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,
  account_id     uuid not null references email_accounts(id) on delete cascade,
  thread_id      uuid not null references threads(id) on delete cascade,
  imap_uid       bigint,
  imap_mailbox   text,
  message_id     text,
  in_reply_to    text,
  references_ids text[] not null default '{}',
  from_name      text,
  from_address   text not null,
  to_addresses   text[] not null default '{}',
  cc_addresses   text[] not null default '{}',
  subject        text,
  date           timestamptz not null,
  body_text      text,
  body_html      text,
  snippet        text,
  seen           boolean not null default false,
  direction      text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  attachments    jsonb not null default '[]',
  created_at     timestamptz not null default now(),
  unique (account_id, imap_mailbox, imap_uid)
);
create index messages_msgid_idx on messages (account_id, message_id);
create index messages_thread_idx on messages (thread_id, date);

alter table threads enable row level security;
create policy "owner read threads" on threads
  for select to authenticated using (owner_id = auth.uid());
alter table messages enable row level security;
create policy "owner read messages" on messages
  for select to authenticated using (owner_id = auth.uid());

-- Outbox of local flag changes the sync worker replays to the IMAP server
-- (mark read/unread, archive). Service-role only: RLS on, zero policies.
-- claimed_at is the idempotency guard: a worker claims a row before acting.
create table flag_ops (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references email_accounts(id) on delete cascade,
  message_id uuid references messages(id) on delete cascade,
  thread_id  uuid references threads(id) on delete cascade,
  op         text not null check (op in ('read', 'unread', 'archive', 'unarchive')),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index flag_ops_account_idx on flag_ops (account_id, claimed_at);
alter table flag_ops enable row level security;
