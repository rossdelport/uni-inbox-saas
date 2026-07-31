-- Last-resort tripwire against the one unrecoverable bug in an email client:
-- recording (and therefore possibly sending) the same outbound message twice.
-- Every legitimate path allocates one RFC Message-ID per send and writes one
-- row; a second insert with the same id is a bug upstream, and this turns it
-- into a loud 23505 instead of a silent duplicate in the thread.
--
-- Verified before applying: zero duplicate (account_id, message_id) pairs
-- among existing outbound rows, including the 116 Sent-sync-adopted ones.

create unique index if not exists messages_outbound_msgid_uniq
  on uni_inbox.messages (account_id, message_id)
  where direction = 'outbound' and message_id is not null;
