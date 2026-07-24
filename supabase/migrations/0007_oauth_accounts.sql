-- OAuth-connected accounts (Google / Microsoft XOAUTH2) alongside password
-- accounts, and a provider list that matches the product: Gmail, iCloud,
-- Outlook, Porkbun (legacy), custom domains.
alter table uni_inbox.email_accounts
  drop constraint if exists email_accounts_provider_preset_check;
alter table uni_inbox.email_accounts
  add constraint email_accounts_provider_preset_check
    check (provider_preset in ('gmail', 'icloud', 'outlook', 'porkbun', 'custom'));

alter table uni_inbox.email_accounts
  add column if not exists auth_method text not null default 'password'
    check (auth_method in ('password', 'oauth_google', 'oauth_microsoft'));
