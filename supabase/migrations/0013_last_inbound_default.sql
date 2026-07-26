-- Fixes a break introduced by 0011.
--
-- 0011 added threads.last_inbound_at as NOT NULL with no default. New threads
-- are inserted before touchThread() populates the rollup columns, so every
-- insert failed with a not-null violation and the syncer stopped ingesting
-- mail entirely.
--
-- resolveThread() now sets the column explicitly, but the default is kept as
-- a backstop so any other insert path cannot reintroduce the same outage.

alter table uni_inbox.threads
  alter column last_inbound_at set default now();
