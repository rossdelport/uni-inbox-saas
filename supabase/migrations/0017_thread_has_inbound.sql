-- Threads you started, and nobody has replied to yet, were showing up in the
-- Inbox. They belong in Sent until a reply arrives.
--
-- Root cause: threading.ts stamped last_inbound_at from the OUTBOUND message
-- (both at insert, and via `newestInbound?.date ?? newest.date` in the rollup).
-- That fallback was added as an ORDERING convenience so a thread awaiting a
-- reply still sorted sensibly. The Inbox list later became a filter on the same
-- column, so "sorts sensibly" quietly turned into "is in the Inbox".
--
-- Why a boolean and not `last_inbound_at is null`:
--
--   1. last_inbound_at is the ORDER BY key for six of seven views. Making it
--      nullable puts NULLs first on a DESC sort (Postgres default), feeds NULL
--      into the keyset pagination predicate where every comparison is false so
--      rows silently vanish, and serialises NULL into the row timestamp the
--      clients type as `string` and pass to `new Date()`, rendering 1 Jan 1970.
--      The installed iOS build cannot be rolled back alongside the API.
--   2. It cannot be made sticky. The retention sweep deletes MESSAGE rows and
--      never recomputes rollups, so a genuine two-way conversation whose
--      inbound half aged out would derive "never had inbound" and be evicted
--      from the Inbox permanently, with the evidence already deleted.
--
-- A boolean fixes both: it is a filter and never a sort key, so no NULL ever
-- reaches ORDER BY, the cursor, or the wire; and the code only ever writes it
-- TRUE, so nothing can un-set it later.
--
-- DEFAULT TRUE is deliberate. The two failure directions are not symmetrical:
-- a thread wrongly LEFT in the Inbox is the status quo we are improving on,
-- while a thread wrongly HIDDEN is indistinguishable from lost mail. So every
-- existing row stays visible unless it is provably safe to hide, and this
-- migration is safe to apply before or after the API deploy in either order.

alter table uni_inbox.threads
  add column if not exists has_inbound boolean not null default true;

-- Hide only threads that provably never received mail. Both conditions matter:
--
--   no inbound message  -> the thread is outbound-only right now.
--   no message older than the retention floor -> nothing can have been swept
--     out from under us, so "no inbound message" means "never had one" rather
--     than "had one and it aged out". 90 days is the shortest configured
--     MAIL_RETENTION_DAYS (.env.example), so it is the conservative bound.
--
-- Threads that fail the second test keep has_inbound = true and stay in the
-- Inbox. Leaving a handful of stale sent-only threads visible is a far cheaper
-- mistake than hiding a real conversation.
update uni_inbox.threads t
   set has_inbound = false
 where not exists (
         select 1 from uni_inbox.messages m
          where m.thread_id = t.id and m.direction = 'inbound')
   and not exists (
         select 1 from uni_inbox.messages m
          where m.thread_id = t.id
            and m.date < now() - interval '90 days');

-- The Inbox list is `where owner_id = ? and has_inbound and not archived and
-- deleted_at is null order by last_inbound_at desc`. Partial on has_inbound so
-- the index only carries rows the Inbox can actually return.
create index if not exists threads_owner_inbound_live_idx
  on uni_inbox.threads (owner_id, archived, last_inbound_at desc)
  where has_inbound and deleted_at is null;
