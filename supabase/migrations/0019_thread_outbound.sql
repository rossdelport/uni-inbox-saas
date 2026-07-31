-- Thread-level outbound facts, the mirror of has_inbound / last_inbound_at.
--
-- has_outbound: whether the user has ever sent anything on this thread. The
-- Sent view today collects outbound message ids on every request; this makes
-- "threads I have replied to" a thread-level fact, and it is the predicate a
-- future "awaiting reply" feature needs (has_outbound and the last inbound
-- message being older than the last outbound one).
--
-- Written by touchThread, which derives both from the message rows it already
-- reads, so the sync path and the send path stay consistent by construction.

alter table uni_inbox.threads
  add column if not exists has_outbound boolean not null default false,
  add column if not exists last_outbound_at timestamptz;

update uni_inbox.threads t
set has_outbound = true, last_outbound_at = m.max_date
from (
  select thread_id, max(date) as max_date
  from uni_inbox.messages
  where direction = 'outbound'
  group by thread_id
) m
where m.thread_id = t.id;
