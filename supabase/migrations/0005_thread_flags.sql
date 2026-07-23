-- Starred and Read-later flags for the dashboard sidebar views. Local-only
-- state (not mirrored to IMAP): flag_ops keeps its read/archive vocabulary.
alter table uni_inbox.threads
  add column if not exists starred    boolean not null default false,
  add column if not exists read_later boolean not null default false;

-- The sidebar filters query these per owner; partial indexes keep them cheap.
create index if not exists threads_starred_idx
  on uni_inbox.threads (owner_id, last_message_at desc) where starred;
create index if not exists threads_read_later_idx
  on uni_inbox.threads (owner_id, last_message_at desc) where read_later;
