# Product

OneInbox: every project inbox in one clutter-free place, for solo founders and
indie hackers. Ross's own pain is the spec: personal Gmail,
perthsolarpanelcleaners.com (Porkbun hosting), trynoisy.com, and ~3 side
projects, each with its own mailbox and none worth a full client setup.

## Positioning

- The wedge: "solo founder with 6 project inboxes, $5/month, zero clutter".
  Team tools (Missive ~$14/user, Front) are overkill; Shortwave is Gmail-only;
  Gmail's built-in POP-fetch is free but ugly and buried. We win on focus and
  price, the same narrow-persona playbook as Noisy.
- The killer detail: replies always go out from the address the mail came to,
  enforced server-side. Never answer a customer from the wrong project again.

## Pricing (Stripe live in code, lookup keys uni_*_monthly)

- Solo $5/mo: 2 inboxes
- Builder $10/mo: 5 inboxes
- Empire $20/mo: 12 inboxes
- 14-day card-less trial (2 inboxes). Paywall moment = wanting the 3rd inbox.

## Locked MVP decisions (2026-07-23)

- IMAP/SMTP only, Gmail via app passwords. NO Gmail OAuth in MVP: dodges
  Google restricted-scope verification + annual CASA assessment ($500-$4500/yr).
  Revisit only when revenue justifies it; re-evaluate Nylas at that point too
  (rejected now: ~$1.50-2.50 per connected account/month kills the margin).
- Read + reply from day one; billing from day one; no Redis (in-process IMAP
  IDLE supervisor); 90-day/500-message rolling window per account, not an
  archive.
- Stack mirrors Noisy so patterns transfer: Express+TS Railway, Vite React
  Vercel, Supabase, Stripe machinery adapted from Noisy's stripeBilling.

## State (2026-07-23)

Full MVP code pushed to main (v0.1): sync engine, unified inbox, reply/compose,
billing, security hardening. Database is LIVE: sharing the iBookshelf Supabase
project (afkgkmhshitfopddadbr) inside the `uni_inbox` schema, migrations
0001-0004 applied. One manual step outstanding there: expose `uni_inbox` in
Settings -> API -> Exposed schemas. Not yet on Railway/Vercel/Stripe;
docs/launch-checklist.md walks the rest. Design restyle to the Maily north
star pending the digest (see design-north-star.md).
