# OneInbox launch checklist

## iOS release

- [ ] Create the App Store Connect listing for bundle ID `co.tryoneinbox.app`.
- [ ] Upload and select the production iOS build.
- [ ] Complete privacy, review, support, screenshots, age rating, and export-compliance metadata.
- [ ] Submit the app for App Review.
- [ ] Record the public App Store download URL after the listing exists.
- [ ] Then add **Download iOS app** to the web dashboard's user-menu dropdown.
  - Open a modal rather than navigating away.
  - Show a scannable QR code generated from the final public App Store URL.
  - Include a normal **Open App Store** link as an accessible fallback.
  - Do not ship the menu item before the real listing URL exists.
  - Test the QR code on a physical iPhone before deploying it.

## OAuth release gates

- [ ] Create the dedicated OneInbox Entra directory and replace the deprecated
      directory-less Microsoft application with a multi-tenant registration.
- [ ] End-to-end test Microsoft OAuth with both a personal Outlook account and a Microsoft 365 work account.
- [ ] Confirm the Microsoft redirect URI is exactly `https://tryoneinbox.co/api/oauth/microsoft/callback`.
- [ ] Submit Google's production verification for the Gmail restricted scope.
- [ ] Complete any Google-required security assessment before public Gmail authorization.
