import { Router } from "express";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { userEmail } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { PRICING } from "../lib/plans.js";
import type { PlanId } from "@uni/shared";

// Owner-only founder dashboard data. Double gate: the signed-in user must be
// the owner email AND supply the admin password header.

export const adminRouter = Router();

adminRouter.use((req, res, next) => {
  if (userEmail(res)?.toLowerCase() !== env.CONTACT_TO_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: "not available" });
  }
  if (String(req.headers["x-admin-password"] ?? "") !== env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: "wrong admin password" });
  }
  next();
});

const DAY_MS = 24 * 3600 * 1000;
/** Traffic rows scanned per refresh. Bounds the payload on a busy month. */
const VIEW_SCAN_LIMIT = 20_000;
/** Keep the owner table fast even after a successful ad campaign. */
const WAITLIST_TABLE_LIMIT = 1_000;
// Express keeps a trailing slash when a visitor loads the directory form of
// the page, so both forms need to count as the same landing page.
const WAITLIST_PATHS = ["/lpwaitlist", "/lpwaitlist/"];

function monthlyMrr(quantity: number | null | undefined): number {
  const qty = Math.max(PRICING.monthlyIncluded, quantity ?? PRICING.monthlyIncluded);
  return PRICING.monthlyBaseUsd + Math.max(0, qty - PRICING.monthlyIncluded) * PRICING.monthlyPerExtraUsd;
}

adminRouter.get("/users", async (_req, res) => {
  // Emails + signup attribution live in auth; billing on profiles; per-user
  // engagement in the admin_user_stats view (aggregated in Postgres, so this
  // does not scale with message count); traffic in page_views.
  const [
    { data: authList, error: authErr },
    { data: profiles },
    { data: stats, error: statsErr },
    { data: accounts },
    { data: views },
  ] = await Promise.all([
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    supabase.from("profiles").select("*"),
    supabase.from("admin_user_stats").select("*"),
    supabase
      .from("email_accounts")
      .select("owner_id, email_address, provider_preset, status, consecutive_failures, last_error"),
    supabase
      .from("page_views")
      .select("path, referrer, created_at")
      .gte("created_at", new Date(Date.now() - 30 * DAY_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(VIEW_SCAN_LIMIT),
  ]);
  if (authErr) {
    logger.error({ authErr }, "admin listUsers failed");
    return res.status(500).json({ error: "could not list users" });
  }
  // Not fatal: the page still renders billing and funnel without engagement
  // columns. Logged rather than swallowed so a missing view is visible.
  if (statsErr) logger.warn({ err: statsErr }, "admin_user_stats unavailable");

  const profByUser = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const statByUser = new Map((stats ?? []).map((s) => [s.user_id as string, s as Record<string, unknown>]));
  const now = Date.now();

  const users = (authList?.users ?? [])
    .map((u) => {
      const p = profByUser.get(u.id) ?? {};
      const s = statByUser.get(u.id) ?? {};
      const rawPlan = (p as { plan?: string }).plan ?? "trial";
      const plan: PlanId = rawPlan === "monthly" || rawPlan === "lifetime" ? rawPlan : "trial";
      const qty = (p as { monthly_quantity?: number | null }).monthly_quantity;
      const trialEnds = (p as { trial_ends_at?: string | null }).trial_ends_at ?? null;
      const mrr = plan === "monthly" ? monthlyMrr(qty) : 0;
      const accountCount = Number(s.accounts ?? 0);
      const paying = plan === "monthly" || plan === "lifetime";
      const lastSignIn = u.last_sign_in_at ?? null;
      // Asked to leave but still inside the paid period. Status alone still
      // reads "trialing"/"active" here, so without this they look healthy
      // right up until they disappear.
      const cancelling =
        (p as { cancel_at_period_end?: boolean | null }).cancel_at_period_end === true;
      const periodEnd = (p as { current_period_end?: string | null }).current_period_end ?? null;
      return {
        id: u.id,
        email: u.email ?? "(no email)",
        name: (u.user_metadata?.full_name as string | undefined) ?? null,
        joined_at: u.created_at,
        confirmed: Boolean(u.email_confirmed_at),
        last_sign_in_at: lastSignIn,
        days_idle: lastSignIn ? Math.floor((now - new Date(lastSignIn).getTime()) / DAY_MS) : null,
        plan,
        plan_label:
          plan === "lifetime"
            ? "Lifetime"
            : plan === "monthly"
              ? `Monthly (${Math.max(PRICING.monthlyIncluded, qty ?? PRICING.monthlyIncluded)} accounts)`
              : trialEnds && new Date(trialEnds).getTime() < now
                ? "Trial ended"
                : "Free trial",
        mrr_usd: mrr,
        trial_ends_at: plan === "trial" ? trialEnds : null,
        trial_days_left:
          plan === "trial" && trialEnds ? Math.ceil((new Date(trialEnds).getTime() - now) / DAY_MS) : null,
        subscription_status: (p as { subscription_status?: string | null }).subscription_status ?? null,
        cancelling,
        cancels_at: cancelling ? periodEnd : null,
        period_end: periodEnd,
        billing_synced_at: (p as { billing_synced_at?: string | null }).billing_synced_at ?? null,
        signup_source: (u.user_metadata?.signup_source as string | undefined) ?? null,
        accounts: accountCount,
        accounts_broken: Number(s.accounts_broken ?? 0),
        providers: (s.providers as string[] | null) ?? [],
        threads: Number(s.threads ?? 0),
        unread: Number(s.unread ?? 0),
        messages: Number(s.messages ?? 0),
        last_mail_at: (s.last_mail_at as string | null) ?? null,
        // The field that matters most right now: where they stalled.
        stage: paying ? "paying" : accountCount > 0 ? "activated" : "signed_up",
      };
    })
    .sort((a, b) => (b.joined_at > a.joined_at ? 1 : -1));

  const emailById = new Map(users.map((u) => [u.id, u.email]));

  // Mailboxes that need a human. A broken account is silent churn: the
  // customer just sees an inbox that quietly stopped updating.
  const attention = (accounts ?? [])
    .filter((a) => a.status !== "active" || Number(a.consecutive_failures ?? 0) > 0)
    .map((a) => ({
      user_email: emailById.get(a.owner_id as string) ?? "(unknown)",
      account_email: a.email_address as string,
      provider: (a.provider_preset as string) ?? "custom",
      status: (a.status as string) ?? "unknown",
      consecutive_failures: Number(a.consecutive_failures ?? 0),
      last_error: (a.last_error as string | null) ?? null,
    }))
    .sort((x, y) => y.consecutive_failures - x.consecutive_failures);

  // Traffic. Grouped here rather than in SQL: the rows are already bounded to
  // 30 days and VIEW_SCAN_LIMIT.
  const since7 = now - 7 * DAY_MS;
  const byDay = new Map<string, number>();
  const byPath = new Map<string, number>();
  const byRef = new Map<string, number>();
  let views7 = 0;
  for (const v of views ?? []) {
    const created = String(v.created_at);
    const day = created.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    byPath.set(String(v.path), (byPath.get(String(v.path)) ?? 0) + 1);
    if (new Date(created).getTime() >= since7) views7++;
    const ref = v.referrer as string | null;
    if (ref) {
      let key = ref;
      if (!ref.startsWith("campaign:")) {
        try {
          key = new URL(ref).hostname;
        } catch {
          key = ref.slice(0, 60);
        }
      }
      if (!key.includes("tryoneinbox")) byRef.set(key, (byRef.get(key) ?? 0) + 1);
    }
  }
  const topOf = (m: Map<string, number>, n = 8) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, views]) => ({ key, views }));
  // 30 contiguous days so a quiet day reads as zero rather than vanishing.
  const byDaySeries: Array<{ day: string; views: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    byDaySeries.push({ day, views: byDay.get(day) ?? 0 });
  }

  // Cash collected: sum of paid Stripe charges (gross) minus refunds.
  let cash: { collected_usd: number; refunded_usd: number } | null = null;
  if (env.STRIPE_SECRET_KEY) {
    try {
      const { getStripe } = await import("../services/stripeBilling.js");
      const stripe = getStripe();
      let collected = 0;
      let refunded = 0;
      let scanned = 0;
      for await (const ch of stripe.charges.list({ limit: 100 })) {
        if (ch.paid) {
          collected += ch.amount;
          refunded += ch.amount_refunded;
        }
        if (++scanned >= 1000) break; // plenty for a long while
      }
      cash = { collected_usd: collected / 100, refunded_usd: refunded / 100 };
    } catch (err) {
      logger.warn({ err }, "admin stripe cash lookup failed");
    }
  }

  const trialsActive = users.filter(
    (u) => u.plan === "trial" && u.trial_ends_at && new Date(u.trial_ends_at).getTime() >= now,
  ).length;
  const activated = users.filter((u) => u.accounts > 0).length;
  const paying = users.filter((u) => u.stage === "paying").length;
  const signups30 = users.filter((u) => new Date(u.joined_at).getTime() >= now - 30 * DAY_MS).length;

  res.json({
    totals: {
      users: users.length,
      activated,
      paying,
      paying_monthly: users.filter((u) => u.plan === "monthly").length,
      lifetime: users.filter((u) => u.plan === "lifetime").length,
      trials_active: trialsActive,
      // The nudge list: a trial about to lapse is the cheapest conversion
      // there is, and the only one with a deadline.
      trials_expiring_soon: users.filter(
        (u) => u.trial_days_left !== null && u.trial_days_left >= 0 && u.trial_days_left <= 2,
      ).length,
      mrr_usd: users.reduce((n, u) => n + u.mrr_usd, 0),
      // Churn already committed but not yet taken effect. Counted apart from
      // MRR rather than deducted from it, because the money is still arriving
      // this period and netting it off would hide both numbers.
      cancelling: users.filter((u) => u.cancelling).length,
      mrr_at_risk_usd: users.reduce((n, u) => n + (u.cancelling ? u.mrr_usd : 0), 0),
      // Oldest reconcile across all tracked subscriptions. If this goes stale
      // the billing numbers on this page are guesses, and the page should say
      // so rather than presenting them with unearned confidence.
      billing_synced_at:
        users
          .map((u) => u.billing_synced_at)
          .filter((d): d is string => Boolean(d))
          .sort()[0] ?? null,
      cash_collected_usd: cash?.collected_usd ?? null,
      refunded_usd: cash?.refunded_usd ?? null,
      accounts_total: users.reduce((n, u) => n + u.accounts, 0),
      accounts_broken: attention.length,
      messages_total: users.reduce((n, u) => n + u.messages, 0),
    },
    // Ordered widest to narrowest so the drop-off is the shape of the chart.
    funnel: [
      { stage: "Visitors (30d)", n: (views ?? []).length },
      { stage: "Signed up (30d)", n: signups30 },
      { stage: "Connected a mailbox", n: activated },
      { stage: "Paying", n: paying },
    ],
    traffic: {
      views_7d: views7,
      views_30d: (views ?? []).length,
      by_day: byDaySeries,
      top_paths: topOf(byPath),
      top_referrers: topOf(byRef),
      // Signals the scan cap was hit, so the numbers read as "at least".
      truncated: (views ?? []).length >= VIEW_SCAN_LIMIT,
    },
    attention,
    users,
  });
});

// Founder-only waitlist dashboard. The public landing page writes sign-ups
// through /api/waitlist; this endpoint is deliberately separate and inherits
// the owner-email + admin-password gate above. No browser client ever reads
// the waitlist tables directly.
adminRouter.get("/waitlist", async (_req, res) => {
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY_MS).toISOString();
  const since7 = new Date(now - 7 * DAY_MS).toISOString();

  const [signupsResult, signups7Result, feedbackCountResult, allViewsResult, views30Result] = await Promise.all([
    supabase
      .from("waitlist_signups")
      .select(
        "id, email, source, page_path, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, promo_code, email_sent_at, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .limit(WAITLIST_TABLE_LIMIT),
    supabase
      .from("waitlist_signups")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since7),
    supabase.from("waitlist_feedback").select("id", { count: "exact", head: true }),
    supabase.from("page_views").select("id", { count: "exact", head: true }).in("path", WAITLIST_PATHS),
    supabase
      .from("page_views")
      .select("created_at, referrer", { count: "exact" })
      .in("path", WAITLIST_PATHS)
      .gte("created_at", since30)
      .order("created_at", { ascending: false })
      .limit(VIEW_SCAN_LIMIT),
  ]);

  if (signupsResult.error) {
    logger.error({ err: signupsResult.error }, "admin waitlist signups query failed");
    // This is the friendly failure mode for a deploy that reaches Railway
    // before its matching Supabase migration is run.
    return res.status(503).json({ error: "Waitlist data is not ready yet. Run the latest Supabase migration first." });
  }
  if (signups7Result.error) logger.warn({ err: signups7Result.error }, "admin waitlist weekly count failed");
  if (feedbackCountResult.error) logger.warn({ err: feedbackCountResult.error }, "admin waitlist feedback count failed");
  if (allViewsResult.error) logger.warn({ err: allViewsResult.error }, "admin waitlist all-time views failed");
  if (views30Result.error) logger.warn({ err: views30Result.error }, "admin waitlist traffic query failed");

  type WaitlistSignupRow = {
    id: string;
    email: string;
    source: string | null;
    page_path: string | null;
    referrer: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    promo_code: string | null;
    email_sent_at: string | null;
    created_at: string;
  };
  type WaitlistFeedbackRow = {
    waitlist_signup_id: string;
    message: string;
    created_at: string;
  };

  const signups = (signupsResult.data ?? []) as WaitlistSignupRow[];
  let feedbackRows: WaitlistFeedbackRow[] = [];
  if (signups.length > 0) {
    const { data, error } = await supabase
      .from("waitlist_feedback")
      .select("waitlist_signup_id, message, created_at")
      .in(
        "waitlist_signup_id",
        signups.map((signup) => signup.id),
      )
      .order("created_at", { ascending: false });
    if (error) logger.warn({ err: error }, "admin waitlist feedback query failed");
    else feedbackRows = (data ?? []) as WaitlistFeedbackRow[];
  }

  // Keep only the latest message per person in the table. It is the one that
  // needs a reply; historical feedback remains safely stored in Postgres.
  const feedbackBySignup = new Map<string, WaitlistFeedbackRow>();
  for (const feedback of feedbackRows) {
    if (!feedbackBySignup.has(feedback.waitlist_signup_id)) {
      feedbackBySignup.set(feedback.waitlist_signup_id, feedback);
    }
  }

  const bySource = new Map<string, number>();
  for (const signup of signups) {
    const source = signup.source?.trim() || "unknown";
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
  }
  const sources = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, signups]) => ({ source, signups }));

  const views = views30Result.data ?? [];
  const byDay = new Map<string, number>();
  const byReferrer = new Map<string, number>();
  let views7 = 0;
  for (const view of views) {
    const createdAt = String(view.created_at);
    const day = createdAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (new Date(createdAt).getTime() >= new Date(since7).getTime()) views7++;
    const referrer = view.referrer as string | null;
    if (!referrer) continue;
    let key = referrer;
    if (!referrer.startsWith("campaign:")) {
      try {
        key = new URL(referrer).hostname;
      } catch {
        key = referrer.slice(0, 60);
      }
    }
    if (!key.includes("tryoneinbox")) byReferrer.set(key, (byReferrer.get(key) ?? 0) + 1);
  }
  const byDaySeries: Array<{ day: string; views: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    byDaySeries.push({ day, views: byDay.get(day) ?? 0 });
  }
  const topReferrers = [...byReferrer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, views]) => ({ key, views }));

  const totalSignups = signupsResult.count ?? signups.length;
  const landingViews = allViewsResult.count ?? 0;
  const views30 = views30Result.count ?? views.length;
  res.json({
    totals: {
      landing_views: landingViews,
      waitlist_signups: totalSignups,
      conversion_percent: landingViews > 0 ? (totalSignups / landingViews) * 100 : 0,
      views_7d: views7,
      views_30d: views30,
      signups_7d: signups7Result.count ?? 0,
      feedback_count: feedbackCountResult.count ?? feedbackRows.length,
    },
    traffic: {
      by_day: byDaySeries,
      top_referrers: topReferrers,
      // The graph reflects a bounded 30-day query. Make a very large launch
      // transparent instead of silently drawing a partial chart as complete.
      truncated: views.length >= VIEW_SCAN_LIMIT,
    },
    sources,
    signups: signups.map((signup) => {
      const feedback = feedbackBySignup.get(signup.id);
      return {
        ...signup,
        feedback: feedback?.message ?? null,
        feedback_at: feedback?.created_at ?? null,
      };
    }),
    table_truncated: totalSignups > signups.length,
  });
});

// Delete a user outright: auth row, and through the FK cascades their
// profile, accounts, sync state, threads, messages and flag ops. Built for
// clearing test signups without a Supabase round trip. Any live Stripe
// subscription is cancelled FIRST: a deleted trial would otherwise convert
// in three days and charge a card for an account that no longer exists.
adminRouter.delete("/users/:id", async (req, res) => {
  const targetId = String(req.params.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(targetId)) return res.status(400).json({ error: "invalid user id" });

  const { data: target } = await supabase.auth.admin.getUserById(targetId);
  if (!target?.user) return res.status(404).json({ error: "no such user" });
  // The admin account is load-bearing; deleting it from its own dashboard
  // would be a memorable afternoon.
  if ((target.user.email ?? "").toLowerCase() === env.CONTACT_TO_EMAIL.toLowerCase()) {
    return res.status(400).json({ error: "You cannot delete your own account from here." });
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("user_id", targetId)
    .maybeSingle();
  if (prof?.stripe_subscription_id) {
    try {
      const { getStripe } = await import("../services/stripeBilling.js");
      await getStripe().subscriptions.cancel(prof.stripe_subscription_id);
      logger.info({ targetId, sub: prof.stripe_subscription_id }, "admin delete: subscription cancelled");
    } catch (err) {
      // Do not delete the user if the live subscription could not be
      // cancelled: an orphaned subscription bills a card forever with no
      // account left to cancel it from.
      logger.error({ err, targetId }, "admin delete: could not cancel subscription");
      return res.status(502).json({ error: "Could not cancel their Stripe subscription. User NOT deleted." });
    }
  }

  const { error } = await supabase.auth.admin.deleteUser(targetId);
  if (error) {
    logger.error({ error, targetId }, "admin delete user failed");
    return res.status(502).json({ error: "Delete failed." });
  }
  logger.info({ targetId, email: target.user.email }, "admin deleted user");
  res.json({ ok: true });
});
