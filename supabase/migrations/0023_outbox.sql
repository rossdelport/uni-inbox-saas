-- The outbox: every send becomes a queued row the worker drains, which is
-- what makes Undo Send and Send Later possible at all. A send inside the undo
-- window is a row that has not been claimed yet; undo is an UPDATE, not an
-- unsend.
--
-- Status machine, one direction only:
--   queued -> sending -> sent
--   queued -> canceled            (undo, or a scheduled send cancelled)
--   sending -> failed             (SMTP said no before anything could deliver)
--   sending -> unknown            (worker died mid-send; NEVER auto-requeued,
--                                  because the bytes may have been delivered)
--
-- The RFC Message-ID is allocated at ENQUEUE time and stored, so a retry of
-- any kind reuses the same id: receiving mail systems dedupe on it, which is
-- the second net under the double-send tripwire in 0022.

create table if not exists uni_inbox.outbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  account_id uuid not null references uni_inbox.email_accounts(id) on delete cascade,
  thread_id uuid references uni_inbox.threads(id) on delete set null,
  kind text not null check (kind in ('reply', 'new', 'forward')),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'canceled', 'failed', 'unknown')),
  -- When the worker may claim it: end of the undo window, or the scheduled
  -- send time.
  not_before timestamptz not null default now(),
  -- Idempotency: one row per client submission. A double-click, a retried
  -- request, an offline queue replay all land on the same row.
  client_token text not null,
  -- The Message-ID that will be on the wire.
  message_rfc_id text not null,
  -- Everything needed to compose the send, except attachments.
  payload jsonb not null,
  -- Attachment bytes (base64), split out so success can null them: at the
  -- send cap with 15 MB attachments this is otherwise ~GBs/day of dead rows.
  attachments jsonb,
  attempts int not null default 0,
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, client_token)
);

alter table uni_inbox.outbox enable row level security;
create policy outbox_owner_select on uni_inbox.outbox
  for select using (auth.uid() = owner_id);
grant select on uni_inbox.outbox to authenticated;

create index if not exists outbox_due_idx
  on uni_inbox.outbox (not_before)
  where status = 'queued';
create index if not exists outbox_thread_idx
  on uni_inbox.outbox (thread_id)
  where status <> 'sent';
