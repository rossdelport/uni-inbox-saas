-- Inbox ordering should follow mail you RECEIVE, not mail you send.
--
-- last_message_at tracks the newest message in either direction, so replying
-- to a thread bumped it to the top of your own inbox. Gmail's behaviour, which
-- this now matches, is that a thread rises when someone replies TO you.
--
-- last_message_at is kept as-is: it is still the thread's true last activity
-- and is what the Sent view orders by.

alter table uni_inbox.threads
  add column if not exists last_inbound_at timestamptz;

-- Backfill. Threads with no inbound message yet (one you started, awaiting a
-- reply) fall back to last_message_at so they still sort sensibly rather than
-- sinking to the bottom forever.
update uni_inbox.threads t
set last_inbound_at = coalesce(
  (select max(m.date) from uni_inbox.messages m
    where m.thread_id = t.id and m.direction = 'inbound'),
  t.last_message_at
)
where last_inbound_at is null;

alter table uni_inbox.threads
  alter column last_inbound_at set not null;

-- Mirrors the existing (owner_id, archived, last_message_at desc) index, since
-- this column is now the inbox keyset sort.
create index if not exists threads_owner_inbound_idx
  on uni_inbox.threads (owner_id, archived, last_inbound_at desc);
