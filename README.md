# Uni-Inbox

One clutter-free inbox for every project you run. Built for solo founders and indie
hackers who juggle a personal Gmail, a couple of custom-domain mailboxes, and three
side projects, and are tired of tab-cycling through webmail.

- Connect any IMAP/SMTP mailbox: Gmail (app password), Porkbun email hosting, anything custom
- One unified, color-coded thread list across every account
- Reply and compose, always from the right address (server-enforced per thread)
- Read/archive state syncs both ways with the source mailbox
- $5 / $10 / $20 per month by number of connected inboxes, 14-day card-less trial

## Stack

Same shape as Noisy: monorepo with `apps/api` (Express + TypeScript, runs API +
IMAP sync worker in one Railway service), `apps/web` (Vite + React dashboard on
Vercel), `supabase/migrations` (Postgres + auth). No Redis: the sync worker is a
supervisor over long-lived `imapflow` IDLE connections, one per active account.

```
apps/api/src
  index.ts        Express app (webhook-before-json, CORS, JWT auth gate)
  worker.ts       sync supervisor + retention sweep
  services/       imapSync (the engine), smtpSend, threading, stripeBilling, ...
  routes/         accounts, inbox, messages, send, billing
apps/web/src      React SPA (inbox, thread view, compose, accounts, billing)
supabase/         migrations 0001-0004 (profiles, accounts, messages, billing)
```

## Local dev

```bash
npm install
cp .env.example .env   # fill in Supabase + CREDENTIALS_KEY (openssl rand -base64 32)
npm run dev:api        # API on :8080 (+ sync worker)
npm run dev:web        # dashboard on :5173, /api proxied to :8080
```

Migrations: apply `supabase/migrations/*.sql` in order to your Supabase project
(dashboard SQL editor or `supabase db push`). Email confirmation should be ON.

Stripe (optional in dev): set `STRIPE_SECRET_KEY` (test mode), run
`npm run stripe:setup --workspace @uni/api`, paste the three printed price ids
into `.env`, and point a webhook at `/api/billing/webhook` with
`checkout.session.completed` + `customer.subscription.*` events.

## Deploy

- **Railway**: repo root, Nixpacks, `railway.json` picks the start command. Env:
  everything in `.env.example` except the `VITE_*` block.
- **Vercel**: project root `apps/web`, SPA rewrite ships in `vercel.json`. Env:
  the `VITE_*` block (`VITE_API_URL` = Railway URL).
- **Supabase**: apply migrations manually per convention; never auto-migrate on deploy.

## Security notes

Mail passwords are encrypted at rest with AES-256-GCM (`CREDENTIALS_KEY`, 32-byte
base64). The `credentials_enc` column is stripped from client grants; only the
service-role API can read it. Logs redact anything credential-shaped (pino
redact + imapflow/nodemailer loggers off). HTML mail is sanitized server-side
(sanitize-html) and again client-side (DOMPurify) into a sandboxed iframe with
remote images blocked by default.
