-- Soft-delete trash for conversations: delete moves a thread here instead of
-- destroying it; restore clears the flag; the retention sweep purges threads
-- deleted more than 30 days ago.
alter table uni_inbox.threads add column deleted_at timestamptz;
create index threads_deleted_idx
  on uni_inbox.threads (owner_id, deleted_at)
  where deleted_at is not null;
