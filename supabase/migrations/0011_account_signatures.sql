-- Per-account email signatures. The HTML is lifted verbatim from the user's
-- own sent mail (or pasted by them), so what OneInbox appends is identical to
-- what their provider's composer used to append.
alter table uni_inbox.email_accounts
  add column if not exists signature_html text,
  add column if not exists signature_text text;
