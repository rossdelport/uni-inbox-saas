# Google OAuth production verification

## Production configuration

- App name: **OneInbox**
- Home page: `https://tryoneinbox.co`
- Privacy policy: `https://tryoneinbox.co/privacy`
- Terms of service: `https://tryoneinbox.co/service`
- Support email: `ross@tryoneinbox.co`
- Authorised domain: `tryoneinbox.co`
- Web redirect URI: `https://tryoneinbox.co/api/oauth/google/callback`
- Requested scopes: `openid`, `email`, `https://mail.google.com/`

On 2 August 2026, the project showed verified branding but had no scopes
declared in Data Access. The three scopes above are now saved. Google marks the
Gmail scope **not yet verified**; the feature categories and justification are
saved, and the Verification Center identifies the demo video as the remaining
submission field.

`https://mail.google.com/` is required because OneInbox reads Gmail through
IMAP and sends through SMTP. It is a restricted scope. OneInbox stores the
encrypted refresh token and the user's synced mail data, so public production
access requires Google's restricted-scope verification and any security
assessment Google assigns. Branding verification alone does not remove the
unverified/restricted-app warning.

## Scope justification for the submission

> OneInbox is a unified email client. A user deliberately connects a Gmail
> mailbox so OneInbox can fetch that mailbox over Gmail IMAP, display its
> messages in the user's private unified inbox, and send user-authored replies
> over Gmail SMTP. The `https://mail.google.com/` scope is the minimum Google
> scope that supports Gmail IMAP and SMTP OAuth. OneInbox does not use Gmail
> data for advertising, sell it, or train AI models with it. Access can be
> revoked by removing the mailbox in OneInbox or through the user's Google
> Account.

## Verification demo recording

Record one continuous, unedited demonstration using the production URLs:

1. Show `https://tryoneinbox.co`, its OneInbox branding, and the privacy and
   terms links.
2. Sign in to a prepared reviewer account at `https://tryoneinbox.co/app/`.
3. Open **Add account**, choose **Gmail**, and click **Continue with Google**.
4. Show the Google consent screen and expand the requested Gmail permission.
5. Approve access and show the browser returning to OneInbox.
6. Show the connected Gmail inbox syncing and opening a message.
7. Send a short reply from OneInbox and confirm it appears in Gmail Sent.
8. Remove the Gmail account from OneInbox and explain how the user can also
   revoke access from their Google Account.

## Submission gates

- [ ] Google Cloud project is the exact project owning the production client ID.
- [ ] Publishing status is **In production** and user type is **External**.
- [ ] Branding, developer contact, home, privacy, terms, and authorised domain
      exactly match the production OneInbox domain.
- [ ] Google Search Console ownership for `tryoneinbox.co` is verified by the
      same Google account/project owner.
- [ ] The OAuth client contains only the exact production callback URI.
- [x] Data Access contains only the three scopes listed above.
- [x] Restricted-scope categories are **Email client** and **Email productivity**.
- [x] Restricted-scope justification is saved.
- [ ] The demo video is uploaded/unlisted and its URL is included.
- [ ] Verification is submitted, Google's follow-up questions are answered,
      and the required security assessment is completed.

Google's review and assessment are external approval processes; submitting
correctly does not make their review complete on the same day.
