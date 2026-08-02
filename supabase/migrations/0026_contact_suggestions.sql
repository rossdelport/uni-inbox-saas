-- Contact suggestions are derived from message envelope metadata already
-- synced into OneInbox. No provider address-book permission is needed.
-- The function returns only addresses, names, usage and recency; message
-- bodies never leave the messages table for this feature.

create index if not exists messages_owner_date_idx
  on uni_inbox.messages (owner_id, date desc);

create or replace function uni_inbox.search_contacts(
  p_owner uuid,
  p_query text default '',
  p_account uuid default null,
  p_limit int default 8
)
returns table(
  email text,
  display_name text,
  frequency int,
  last_seen_at timestamptz,
  account_ids uuid[]
)
language sql stable security definer set search_path = '' as $$
  with own_addresses as (
    select lower(trim(a.email_address)) as email
      from uni_inbox.email_accounts a
     where a.owner_id = p_owner
  ),
  envelope_events as (
    -- Inbound senders carry the best available display name.
    select lower(trim(m.from_address)) as email,
           nullif(trim(m.from_name), '') as display_name,
           m.date,
           m.account_id
      from uni_inbox.messages m
     where m.owner_id = p_owner
       and m.from_address is not null
       and (p_account is null or m.account_id = p_account)

    union all

    -- Recipients are useful even when the user has never received a reply.
    select lower(trim(recipients.address)) as email,
           null::text as display_name,
           m.date,
           m.account_id
      from uni_inbox.messages m
      cross join lateral unnest(
        coalesce(m.to_addresses, '{}'::text[]) ||
        coalesce(m.cc_addresses, '{}'::text[])
      ) as recipients(address)
     where m.owner_id = p_owner
       and (p_account is null or m.account_id = p_account)
  ),
  grouped as (
    select e.email,
           (array_agg(e.display_name order by e.date desc)
             filter (where e.display_name is not null))[1] as display_name,
           count(*)::int as frequency,
           max(e.date) as last_seen_at,
           array_agg(distinct e.account_id order by e.account_id) as account_ids
      from envelope_events e
     where e.email <> ''
       and not exists (
         select 1 from own_addresses own where own.email = e.email
       )
     group by e.email
  )
  select g.email,
         g.display_name,
         g.frequency,
         g.last_seen_at,
         g.account_ids
    from grouped g
   where coalesce(trim(p_query), '') = ''
      or g.email ilike '%' || trim(p_query) || '%'
      or coalesce(g.display_name, '') ilike '%' || trim(p_query) || '%'
   order by
     case
       when g.email ilike trim(p_query) || '%' then 0
       when coalesce(g.display_name, '') ilike trim(p_query) || '%' then 1
       else 2
     end,
     g.frequency desc,
     g.last_seen_at desc,
     g.email
   limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

revoke all on function uni_inbox.search_contacts(uuid, text, uuid, int)
  from public, anon, authenticated;
grant execute on function uni_inbox.search_contacts(uuid, text, uuid, int)
  to service_role;
