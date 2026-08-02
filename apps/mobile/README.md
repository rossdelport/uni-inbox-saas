# OneInbox iOS app

Expo SDK 54 + Expo Router + TypeScript. This is the native companion for the
OneInbox service: sign in, read the unified inbox, search, open threads, reply,
compose, archive, star, snooze, delete, connect/remove inboxes, and manage the
OneInbox profile.

The iOS app is not a checkout surface. It shows the existing account's plan
status but does not show prices, sell subscriptions, link to checkout, or ask a
user to purchase elsewhere.

## Run locally

```sh
npm ci
npm run start
```

Scan the QR code with Expo Go, or launch the iOS simulator with `npm run ios`.

## Config

Defaults point at production (`https://tryoneinbox.co` and the production
Supabase project), so a fresh clone works with no local environment file.
Override with `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` to target another environment. The Supabase
anonymous key is intentionally public; Row Level Security is the access gate.

OAuth begins in the app, completes through OneInbox's server callback, and
returns through the fixed `oneinbox://oauth` scheme. Never replace that with an
arbitrary callback supplied by the client.

## Verification

```sh
npm run typecheck
npx expo export --platform ios --output-dir dist-ios
```

For App Store builds:

```sh
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

The production EAS project is `@rossdelport/oneinbox`; the bundle identifier is
`co.tryoneinbox.app`. Distribution signing and submission require access to the
OneInbox Apple Developer/App Store Connect team.

## Release follow-up

After the public App Store URL exists, complete the QR-code web menu task in
[`docs/launch-checklist.md`](../../docs/launch-checklist.md).
