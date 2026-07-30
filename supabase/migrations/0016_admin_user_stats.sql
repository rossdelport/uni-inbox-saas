-- Per-user aggregates for the founder analytics page.
--
-- A view rather than JS aggregation: the admin page refreshes on a timer, and
-- counting threads/messages client-side means shipping every owner_id in the
-- table to the API on every refresh. That is harmless at four users and
-- ruinous at four hundred, since retention allows ~1000 messages per account.
--
-- Read by the service role only (the /api/admin routes). Explicitly revoked
-- from anon and authenticated so it can never be reached from a browser token.

create or replace view uni_inbox.admin_user_stats as
select
  p.user_id,
  coalesce(acc.accounts, 0)         as accounts,
  coalesce(acc.accounts_broken, 0)  as accounts_broken,
  acc.providers,
  coalesce(thr.threads, 0)          as threads,
  coalesce(thr.unread, 0)           as unread,
  coalesce(msg.messages, 0)         as messages,
  msg.last_mail_at
from uni_inbox.profiles p
left join (
  select
    owner_id,
    count(*)                                                                   as accounts,
    count(*) filter (where status <> 'active' or consecutive_failures > 0)      as accounts_broken,
    array_agg(distinct provider_preset)                                        as providers
  from uni_inbox.email_accounts
  group by owner_id
) acc on acc.owner_id = p.user_id
left join (
  select owner_id, count(*) as threads, count(*) filter (where unread) as unread
  from uni_inbox.threads
  where deleted_at is null
  group by owner_id
) thr on thr.owner_id = p.user_id
left join (
  select owner_id, count(*) as messages, max(date) as last_mail_at
  from uni_inbox.messages
  group by owner_id
) msg on msg.owner_id = p.user_id;

revoke all on uni_inbox.admin_user_stats from anon, authenticated;
grant select on uni_inbox.admin_user_stats to service_role;
