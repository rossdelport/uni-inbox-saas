-- A snoozed message is an explicit reminder, even when it came from the
-- mailbox backlog before the account was connected. Keep a marker so the
-- browser badge can count that wake-up without counting every old unread mail.
alter table uni_inbox.threads
  add column if not exists snooze_woke_at timestamptz;

-- Replace the existing count function with the same predicate plus the
-- explicit snooze reminder exception. The function remains service-role only;
-- the API supplies the authenticated owner id after checking the JWT.
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
     and (t.last_inbound_at >= a.created_at or t.snooze_woke_at is not null)
   group by t.account_id, t.split_class;
$$;

revoke all on function uni_inbox.inbox_counts(uuid) from public, anon, authenticated;
grant execute on function uni_inbox.inbox_counts(uuid) to service_role;
