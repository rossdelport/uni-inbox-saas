-- The `PUBLIC` role can be inherited by browser-facing database roles on
-- older Supabase projects. Revoke it explicitly so waitlist emails and
-- attribution remain accessible only through the server-side service role.
revoke all on table uni_inbox.waitlist_signups from public, anon, authenticated;
revoke all on table uni_inbox.waitlist_feedback from public, anon, authenticated;

grant select, insert, update, delete on table uni_inbox.waitlist_signups to service_role;
grant select, insert, update, delete on table uni_inbox.waitlist_feedback to service_role;
