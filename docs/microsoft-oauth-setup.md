# Microsoft OAuth production setup

## Registration status — 2 August 2026

The old production client (`a91bd07c-c416-446f-9189-ce8e008ca9cc`) was a
directory-less legacy application. Microsoft rejected a Fenix work-account
test with `AADSTS700016` because that application was not present in the Fenix
tenant.

A replacement multi-tenant registration has now been created in the dedicated
OneInbox Azure directory. Its client ID is `38588a37-0bcc-49bf-bc52-1fa24f2f5e45`.
The Exchange Online IMAP and SMTP delegated permissions were added through the
manifest because the new Azure-only directory has no Microsoft 365 service
principal to show in the permission picker. Do not grant consent in that
directory or buy a Microsoft 365 subscription for it; mailbox consent happens
in each user's own Microsoft 365 tenant.

The remaining production step is to replace `MS_CLIENT_ID` and
`MS_CLIENT_SECRET` in the hosting service, then test against Fenix. Do not
attach the OneInbox identity to the Fenix work tenant.

## Required registration

- Name: **OneInbox**
- Supported account types: **Accounts in any organisational directory
  (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts**
- Platform: **Web**
- Redirect URI: `https://tryoneinbox.co/api/oauth/microsoft/callback`

Delegated permissions/consent requested by the application:

- `openid`
- `profile`
- `email`
- `offline_access`
- `https://outlook.office.com/IMAP.AccessAsUser.All`
- `https://outlook.office.com/SMTP.Send`

Create a client secret, store its **value** (not its identifier) as the hosting
secret, and never commit it. Replace `MS_CLIENT_ID` and `MS_CLIENT_SECRET` in
the production service together, redeploy, and verify `/api/oauth/providers`
still reports `microsoft: true`.

## Acceptance tests

- [ ] Personal `@outlook.com`/`@hotmail.com` account authorises and syncs.
- [ ] Fenix Microsoft 365 work account authorises and syncs.
- [ ] A work account from a second Entra tenant authorises and syncs.
- [ ] A reply sends from each account and appears in Sent Items.
- [ ] Reconnect replaces a revoked refresh token without adding a duplicate.
- [ ] Removing the account deletes the OneInbox copy but does not delete mail
      from Microsoft.

Some Microsoft 365 administrators disable SMTP AUTH for their organisation or
mailbox. If consent and IMAP succeed but sending fails, the tenant administrator
must enable Authenticated SMTP for that mailbox or OneInbox must add a Microsoft
Graph send-mail fallback.
