-- Snooze: hide a conversation from the Inbox until a chosen time, then bring
-- it back. The upgrade of Read Later, which could only mean "some day" and
-- never hid anything.
--
-- Why a NOT NULL epoch sentinel and not a nullable column: "not snoozed" has
-- to be expressible as a PostgREST method-arg filter (.lte), because or= is
-- where this codebase has been burned before (an ISO timestamp inside or=
-- failed silently and stranded 2,209 flag ops; see imapSync.applyFlagOps).
-- A nullable column forces or=(is.null,lte.<iso>). NOT NULL epoch keeps the
-- filter a single .lte. The API maps epoch to null on the wire, so no client
-- ever sees the sentinel.
--
-- read_later STAYS and is not migrated into a wake time: it means "in my
-- saved list, no date". Inventing a wake time for those rows would hide
-- threads the user can see today and pop them back at a moment they never
-- chose. A thread wrongly LEFT in the Inbox is the status quo; a thread
-- wrongly HIDDEN is indistinguishable from lost mail. Snoozing sets
-- read_later too, so the Snoozed list is still just read_later = true and
-- the installed iOS build keeps working unchanged.

alter table uni_inbox.threads
  add column if not exists snooze_until timestamptz not null default 'epoch'::timestamptz,
  add column if not exists snoozed_at timestamptz;

-- Sweep + wake queries: only rows actually snoozed are in the index.
create index if not exists threads_owner_snoozed_idx
  on uni_inbox.threads (owner_id, snooze_until)
  where snooze_until > 'epoch'::timestamptz;

-- The counts function gains the same predicate the Inbox list applies: a
-- snoozed thread is not in the Inbox, so it must not be in the badge.
create or replace function uni_inbox.inbox_counts(p_owner uuid)
returns table (account_id uuid, split_class text, unread int)
language sql stable security definer set search_path = '' as $$
  select t.account_id, t.split_class, count(*)::int
    from uni_inbox.threads t
    join uni_inbox.email_accounts a on a.id = t.account_id
   where t.owner_id = p_owner
     and a.status <> 'disabled'
     and t.unread
     and t.archived = false
     and t.deleted_at is null
     and t.has_inbound
     and t.snooze_until <= now()
     and t.last_inbound_at >= a.created_at
   group by t.account_id, t.split_class;
$$;

revoke all on function uni_inbox.inbox_counts(uuid) from public, anon, authenticated;
grant execute on function uni_inbox.inbox_counts(uuid) to service_role;
