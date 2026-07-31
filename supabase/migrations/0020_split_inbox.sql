-- Split Inbox: the plain Inbox becomes three piles instead of one.
--
--   important  = a person wrote it. Nothing marked it bulk or automated.
--   newsletter = you are on a list and can leave it (List-Unsubscribe,
--                List-Id, or Precedence: bulk|list).
--   other      = a robot wrote it and there is nothing to leave: receipts,
--                alerts, password resets, no-reply notifications.
--
-- Why a column on threads rather than a filter over messages: GET /api/inbox
-- is a keyset query over threads. Resolving a split through messages would
-- mean the capped two-step id collection Sent and search already use, and
-- both are capped precisely because they cannot paginate. A denormalised
-- column is one more equality that ANDs with the existing cursor predicate.
--
-- DEFAULT 'important' is the safe direction: a thread wrongly left in the
-- pile the user watches is a nuisance, a thread wrongly filed into a pile
-- they never open is indistinguishable from lost mail. Every existing row
-- starts in Important and only leaves on evidence.

alter table uni_inbox.threads
  add column if not exists split_class text not null default 'important'
    check (split_class in ('important', 'newsletter', 'other'));

-- The evidence the verdict was made from, one row per message. Storing only
-- the verdict would not allow re-tuning: a better rule needs the raw
-- signals, and the headers are gone the moment ingest returns. Empty array
-- is the common case. Nothing queries this at request time; no index.
alter table uni_inbox.messages
  add column if not exists bulk_signals text[] not null default '{}';

-- Backfill for mail already stored, which was ingested before headers were
-- read. Two deliberately conservative passes, both guarded on
-- split_class = 'important' so they cannot fight each other or run twice.
-- Both require the thread to have no outbound message: if you have replied
-- in a thread it is important to you, whatever the sender looks like.

-- Newsletters: every inbound message in the thread mentions unsubscribing.
-- Weak next to a real List-Unsubscribe header, strong enough that a false
-- positive is almost always something the user did subscribe to.
update uni_inbox.threads t
   set split_class = 'newsletter'
 where t.split_class = 'important'
   and not exists (select 1 from uni_inbox.messages m
                    where m.thread_id = t.id and m.direction = 'outbound')
   and (select bool_and(coalesce(m.body_text, '') ilike '%unsubscribe%'
                     or coalesce(m.body_html, '') ilike '%unsubscribe%')
          from uni_inbox.messages m
         where m.thread_id = t.id and m.direction = 'inbound');

-- Other: a robot sent it. Local part only, and a deliberately narrow list.
-- support@, info@, hello@, team@, contact@, billing@ and sales@ are NOT here
-- on purpose: those are staffed inboxes where a human replies, and burying a
-- real reply is the expensive mistake.
update uni_inbox.threads t
   set split_class = 'other'
 where t.split_class = 'important'
   and not exists (select 1 from uni_inbox.messages m
                    where m.thread_id = t.id and m.direction = 'outbound')
   and exists (select 1 from uni_inbox.messages m
                where m.thread_id = t.id
                  and m.direction = 'inbound'
                  and lower(split_part(m.from_address, '@', 1)) ~
     '^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|alerts?|automated|auto-?reply)([+._-].*)?$');

-- One index serves the split filter AND the order-by. Same partial predicate
-- as the live-inbox index. This does not replace the unsplit index: with
-- split_class between owner_id and the sort key it cannot serve the unsplit
-- Inbox, and unsplit is still the default view. Both are required.
create index if not exists threads_owner_split_live_idx
  on uni_inbox.threads (owner_id, split_class, archived, last_inbound_at desc)
  where has_inbound and deleted_at is null;

-- Sidebar and split-strip numbers in one round trip, replacing the
-- one-HEAD-count-per-account loop and adding the per-split breakdown free.
-- Predicate copied from /api/inbox/counts verbatim and must stay identical:
-- live, unarchived, inbound-bearing threads, mail arrived after connect.
--
-- security definer + empty search_path. Execute is service_role ONLY:
-- p_owner is the sole owner check, so granting this to authenticated would
-- be an IDOR.
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
     and t.last_inbound_at >= a.created_at
   group by t.account_id, t.split_class;
$$;

revoke all on function uni_inbox.inbox_counts(uuid) from public, anon, authenticated;
grant execute on function uni_inbox.inbox_counts(uuid) to service_role;
