-- Live inbox updates.
--
-- The browser subscribes to this table directly through Supabase Realtime,
-- authorised by the existing "owner read threads" policy (SELECT to
-- authenticated where owner_id = auth.uid()), so a user can only ever be
-- woken by their own mail.
--
-- Only threads, not messages. The list renders threads, and connecting a
-- mailbox inserts hundreds of message rows in one burst, which would be
-- hundreds of events saying the same thing.
--
-- replica identity full so Realtime can evaluate that policy against the row
-- it is about to send, rather than just the primary key.
alter table uni_inbox.threads replica identity full;
alter publication supabase_realtime add table uni_inbox.threads;
