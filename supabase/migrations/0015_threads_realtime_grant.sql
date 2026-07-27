-- Realtime was silently delivering nothing. RLS policies are filters on top
-- of table privileges, and `authenticated` (the role Realtime authorises the
-- browser's subscription as) had no SELECT on uni_inbox.threads, so every
-- change event failed the auth check and was dropped. The websocket connected
-- and subscribed fine, which is what made it look like it worked.
--
-- The owner-only RLS policy still applies on top of this grant, so a user
-- receives events for their own threads and nothing else. The schema is not
-- in PostgREST's exposed list, so this opens no REST surface.
grant select on uni_inbox.threads to authenticated;
