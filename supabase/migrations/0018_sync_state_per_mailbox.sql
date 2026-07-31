-- One cursor row per (account, mailbox role), unlocking a second synced
-- mailbox (Sent) per account.
--
-- The mailbox column has been decorative since 0002: account_id alone was the
-- primary key, every reader did .eq("account_id").maybeSingle(), and the one
-- row per account was implicitly the INBOX cursor. The first Sent cursor row
-- would have made every one of those maybeSingle() calls error, stopping
-- INBOX sync and older-mail backfill for the account at once, silently.
--
-- Deploy order matters, in this direction: this migration is safe under the
-- OLD code (still exactly one row per account, and PostgREST upserts resolve
-- on the new composite key with the column default filling mailbox_role), but
-- the NEW code's .eq("mailbox_role", ...) filters error until the column
-- exists. Schema first, code second.

alter table uni_inbox.sync_state
  add column if not exists mailbox_role text not null default 'inbox'
    check (mailbox_role in ('inbox', 'sent'));

alter table uni_inbox.sync_state
  drop constraint sync_state_pkey;

alter table uni_inbox.sync_state
  add constraint sync_state_pkey primary key (account_id, mailbox_role);
