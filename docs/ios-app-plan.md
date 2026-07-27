# OneInbox iOS app — build plan

Target: **Tuesday 28 July 2026**, running on Ross's iPhone.
Stack: **Expo SDK 57 + React Native + expo-router**, TypeScript.

> **Status (Mon 27 Jul, overnight):** steps 1–6 are BUILT at `apps/mobile` —
> sign-in, inbox (tabs, account filter, badges, pull-to-refresh, read all),
> thread view (HTML in WebViews with auto-height), actions, reply, plan gate.
> Typecheck and a full Metro iOS export pass. What no container can do is
> touch a phone, so Tuesday is now the device day: `cd apps/mobile && npm run
> start`, scan the QR with Expo Go, and shake out on real hardware (step 7
> below). See `apps/mobile/README.md`.

---

## Definition of done (agreed)

A dev app on the phone that can: sign in, show the unified inbox, open a
thread, read it properly formatted, reply, and mark read / archive / delete.

**Not** in this build: push notifications, connecting mailboxes, compose-new,
search, billing. Each is listed under "Next" with a reason.

---

## The single biggest accelerator: it runs in Expo Go

Every dependency below is either pure JavaScript or bundled into Expo Go.
Nothing requires a native build on day one:

- no EAS build, no code signing, no provisioning profiles
- no Apple Developer account ($99/yr) until TestFlight
- no Mac (EAS builds in the cloud when we do need one)

Install Expo Go from the App Store, scan a QR code from the dev server, done.
This is why "on my phone by Tuesday" is realistic and "on the App Store by
Tuesday" is not.

---

## What we already have (verified, not assumed)

The API was built bearer-token-first, which makes it portable as-is:

| Piece | Status for mobile |
| --- | --- |
| `packages/shared` types | Ports directly, pure TypeScript |
| Every `/api/*` endpoint | Unchanged. Auth is `Authorization: Bearer <jwt>` |
| CORS | Already passes origin-less requests, which is what RN sends |
| `@supabase/supabase-js` | Works, needs an AsyncStorage adapter |
| `@tanstack/react-query` | Unchanged |
| `lib/api.ts`, `lib/queries.ts` | Port with a base-URL change |
| `lib/format.ts` | Pure functions, port directly |
| Realtime inbox updates | Same client, same channel |

**Must be rebuilt:** all UI (no CSS in React Native), navigation
(`react-router-dom` → `expo-router`), and HTML email rendering.

---

## Decisions

### Payments: sign-in only

Apple's Guideline 3.1.1 forbids selling digital subscriptions outside their
IAP system. OneInbox bills $5/mo and $50 lifetime through Stripe, so the app
must not offer, mention or link to a purchase. Netflix and Spotify ship the
same way.

Consequences for this build:

- **No signup screen.** New users sign up on the web. Sign-in only.
- An unpaid user who signs in sees "Manage your plan at tryoneinbox.co",
  not a checkout. The web payment gate must NOT be ported as-is.
- Revisit IAP later as a business decision, not a technical one. Apple takes
  15-30% and it means reconciling two billing systems against Stripe.

### Repo layout: `apps/mobile` as a workspace

Sits beside `apps/api` and `apps/web`, so `@uni/shared` resolves through the
existing npm workspace and types stay in one place.

Known friction: Metro does not follow symlinked workspace packages by
default. Fixed with `watchFolders` at the repo root plus `nodeModulesPaths`
in `metro.config.js`. Budgeted below rather than discovered at hour six.

### Config

Mobile cannot use the web's relative `/api` (there is no origin), so the base
URL becomes absolute:

- `EXPO_PUBLIC_API_URL` = `https://tryoneinbox.co`
- `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`

The Supabase client needs `detectSessionInUrl: false` (a web-only feature that
breaks in RN) and `storage: AsyncStorage` so sessions survive app restarts.

---

## The build sequence (steps 1–6 done overnight; 7 needs the phone)

Each step ends in something visible on the phone. If we run out of day, we
stop at a working app rather than a half-finished one.

**1. Scaffold and sign in** (~1h)
`apps/mobile` workspace, Expo SDK 57, Metro monorepo config, Supabase client
with AsyncStorage, sign-in screen.
→ *Milestone: sign in as ross@ on the phone, session survives a reload.*

**2. API layer and inbox list** (~1h)
Port `api.ts` and `queries.ts`, wire `useInbox` into a `FlatList` with
pull-to-refresh and the account colour dot.
→ *Milestone: real threads on screen.*

**3. Thread view** (~2h, the risky one)
Message list plus HTML bodies in a `react-native-webview` with auto-height.
Email HTML is hostile and there is no browser in RN.
→ *Milestone: a real email reads correctly, images and all.*
→ *Fallback if it fights: render `body_text` and revisit. Do not lose the day here.*

**4. Actions** (~1h)
Mark read on open, archive, delete, star, using the existing optimistic
mutations and their rollbacks.
→ *Milestone: actions stick, and survive a pull-to-refresh.*

**5. Reply** (~1h)
`POST /api/threads/:id/reply`, which already handles quoting and sends from
the address that received the thread.
→ *Milestone: reply from the phone, receive it on the other side.*

**6. Accounts and gate** (~1h)
Per-account filter, unread counts, and the "manage your plan on the web"
screen for unpaid users.
→ *Milestone: switch accounts, counts match the web dashboard.*

**7. Shake-out on device** (~1h)
Real use over the flaky-network case, empty states, dark mode sanity.

---

## Risks, and what we do about them

1. **HTML email in a WebView.** Auto-height is the classic time sink.
   *Mitigation:* hard 2h budget, plain-text fallback, move on.
2. **Metro plus npm workspaces.** Silent "cannot resolve @uni/shared".
   *Mitigation:* configured in step 1, before anything depends on it.
3. **Token expiry.** Supabase refresh works differently when an app is
   backgrounded for hours.
   *Mitigation:* `autoRefreshToken: true` plus an AppState listener that
   refreshes on foreground. Test by backgrounding overnight.
4. **Scope creep toward push.** Push is the best reason to own a mail app and
   it will be tempting. It needs an APNs key, a device-token table and a
   server hook in the ingest path. That is its own day.

---

## Next, after it works

In the order I would do them:

1. **Push notifications.** The actual reason a mail app beats a website.
   Needs APNs credentials, `expo-notifications`, a `device_tokens` table, and
   a hook where `ingestMessage` writes new mail. Requires a dev build, so it
   is also the moment we need the Apple Developer account.
2. **TestFlight.** EAS build, bundle ID, icons, first upload.
3. **Connect a mailbox from the phone**, so onboarding does not require a
   laptop.
4. **Compose new, search, attachments.**
5. **App Store submission**: screenshots, privacy labels, support URL,
   review. Budget several days including a rejection round.
