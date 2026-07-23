# Uni-Inbox — project context

Uni-Inbox is a unified email inbox SaaS for solo founders and indie hackers running
multiple projects: connect every project mailbox (Gmail via app password, Porkbun,
any IMAP) and live in one clutter-free, color-coded inbox that replies from the
right address every time. Tiers: Solo $5 (2 inboxes), Builder $10 (5), Empire $20 (12),
14-day card-less trial. Ross is the first user (personal Gmail,
perthsolarpanelcleaners.com on Porkbun, trynoisy.com, plus side projects).

Monorepo, same shape as Noisy: `apps/api` (Express + TS + IMAP sync worker on
Railway), `apps/web` (Vite React on Vercel), `supabase/migrations`. Read
`README.md` for architecture, `docs/launch-checklist.md` for deploy state.

## Working memory

`docs/context/` is the committed working memory for this project. Start at
[`docs/context/MEMORY.md`](docs/context/MEMORY.md).

## Standing rules (inherited from Ross's conventions)

- **Never use em dashes in any user-facing copy.** Commas, colons, periods or
  middots instead. (Code comments may use them.)
- Secrets live only in the gitignored root `.env` and in Railway/Vercel. Never
  in the repo. `CREDENTIALS_KEY` loss = every user re-enters mail passwords.
- Context files are point-in-time notes. Verify against code and live services
  before acting.

## Design north star

The UI/UX target for both the marketing site and the dashboard is the **Maily
Framer site**: https://maily-template.framer.website/ . See
[`docs/context/design-north-star.md`](docs/context/design-north-star.md) for
status: the pixel-level digest (palette, type scale, components) is PENDING
because cloud sessions cannot reach framer.website through the network policy.
Do not guess at its tokens; get screenshots or run from an unrestricted machine,
then fill that file in.
