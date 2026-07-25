-- Older-mail backfill needs a floor marker.
--
-- sync_state only tracked last_seen_uid (the NEWEST message synced), which is
-- all the live syncer needs. Pulling older mail on demand needs to know how
-- far DOWN we have already reached, so repeated requests keep walking
-- backwards instead of refetching the same block.

alter table uni_inbox.sync_state
  add column if not exists oldest_seen_uid bigint;

-- Backfill from what is already stored: the lowest INBOX uid per account.
-- Null stays null for accounts that have not synced yet; the first backfill
-- seeds it from whatever is present at that point.
update uni_inbox.sync_state s
set oldest_seen_uid = (
  select min(m.imap_uid) from uni_inbox.messages m
   where m.account_id = s.account_id
     and m.imap_mailbox = 'INBOX'
     and m.imap_uid is not null
)
where oldest_seen_uid is null;
