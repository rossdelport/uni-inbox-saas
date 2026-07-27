# OneInbox iOS app

Expo SDK 57 + expo-router + TypeScript. A mobile client for the existing API:
sign in, read the unified inbox, open threads, reply, archive / star / delete.
Accounts, signup and billing all stay on the web (Apple Guideline 3.1.1: the
app never sells or links to a purchase).

## Run it on your phone

1. Install **Expo Go** from the App Store.
2. On the same Wi-Fi network:

   ```sh
   cd apps/mobile
   npm run start
   ```

3. Scan the QR code with the iPhone camera. That's it — no Mac, no Apple
   Developer account, no build step.

## Config

Defaults are baked in and point at production (`https://tryoneinbox.co` and
the prod Supabase project), so a fresh clone works with zero setup. Override
with `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY` (in `.env` or the shell) to point elsewhere.
The Supabase anon key is public by design; RLS is the gate.

## Layout

```
src/app/            expo-router routes
  sign-in.tsx       password sign-in (no signup here, web only)
  (app)/            session-guarded group; plan gate + realtime live here
    index.tsx       unified inbox: view tabs, account filter, badges
    thread/[id].tsx conversation: HTML mail in WebViews, reply bar
src/lib/            config, supabase, api, queries, realtime, auth, theme
src/components/     ThreadRow, MessageCard, HtmlBody, ReplyBar, PlanGate, ...
```

`src/lib/{api,queries,realtime,types,format}.ts` are ports of the same files
in `apps/web` — same query keys, same optimistic updates. When the API
changes, update both.

## Verification without a device

```sh
npx tsc --noEmit            # types
npx expo export --platform ios   # full Metro bundle, catches what tsc can't
```

## Next (in order)

1. Push notifications (APNs + expo-notifications + device_tokens table + a
   hook in ingestMessage). Needs a dev build and the Apple Developer account.
2. TestFlight (EAS build, icons, bundle id `co.tryoneinbox.app`).
3. Connect a mailbox from the phone.
4. Attachments download, compose-new, search.
