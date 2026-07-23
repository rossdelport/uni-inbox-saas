# Launch checklist

The code in this repo is complete through billing. What remains is wiring the
three external services and verifying against real mailboxes. In order:

## 1. Supabase (~10 min)
- [ ] Create project (region close to Railway region)
- [ ] Apply `supabase/migrations/0001..0004` in order (SQL editor)
- [ ] Auth: email confirmation ON
- [ ] Copy: project URL, anon key, service role key

## 2. Railway (~10 min)
- [ ] New service from this repo (Nixpacks reads `railway.json`)
- [ ] Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
      `CREDENTIALS_KEY` (`openssl rand -base64 32`, save it somewhere safe:
      losing it = every user re-enters passwords), `DASHBOARD_URL` (Vercel URL,
      after step 3), `CORS_ORIGINS` (Vercel URL)
- [ ] Confirm `/health` responds on the public URL

## 3. Vercel (~5 min)
- [ ] Import repo, root directory `apps/web`
- [ ] Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (Railway URL)
- [ ] Sign up, confirm email, sign in on the deployed URL

## 4. First real verification (the important one)
- [ ] Connect personal Gmail via app password (myaccount.google.com/apppasswords)
- [ ] Connect the Porkbun mailbox (verify hosts in Porkbun dashboard if the
      preset fails; presets assume imap.porkbun.com / smtp.porkbun.com:587)
- [ ] Send yourself mail from outside; confirm it appears within ~1 min
- [ ] Mark read in Uni-Inbox -> shows read in Gmail web; archive -> lands in All Mail
- [ ] Reply from a Porkbun thread; confirm recipient's Gmail threads it and the
      From address is the Porkbun one; copy appears in Porkbun Sent
- [ ] Enter a wrong password on purpose; account flips to "Sign-in failed",
      Railway logs show NO plaintext password
- [ ] Grep Railway logs for your app password: must be zero hits

## 5. Stripe (test then live) (~20 min)
- [ ] Test mode: `npm run stripe:setup --workspace @uni/api`, put price ids in env
- [ ] Webhook endpoint `<railway>/api/billing/webhook`:
      `checkout.session.completed`, `customer.subscription.created/updated/deleted`
- [ ] Trial user hits 2-inbox cap -> checkout Builder with 4242 card -> 3rd inbox connects
- [ ] Cancel in portal -> plan drops, excess inboxes flip to Paused (not deleted)
- [ ] Repeat setup script + webhook in live mode; swap live keys into Railway

## 6. Before telling anyone
- [ ] Custom domain on Vercel + set `DASHBOARD_URL`/`CORS_ORIGINS` to it
- [ ] Lock `CORS_ORIGINS` to the real domain
- [ ] Second `CREDENTIALS_KEY` backup (password manager)
- [ ] Marketing page (separate task; dashboard Login doubles as landing for now)
