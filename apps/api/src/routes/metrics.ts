import { Router, type Request, type Response } from "express";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { userEmail } from "../lib/auth.js";
import { allow } from "../lib/rateLimit.js";

// First-party, cookie-less marketing analytics. Views are recorded server-side
// as pages are served; the summary endpoint is for the owner's eyes only.

/**
 * Server-side page view, recorded once Express has finished serving an HTML
 * page.
 *
 * This replaces a client beacon that recorded nothing whatsoever in
 * production: page_views sat at zero rows for the life of the project while
 * real people signed up and left. Two independent reasons, both closed here.
 * "/api/metrics/view" is precisely the shape ad blockers drop, so the request
 * frequently never left the browser at all; and the insert was fire-and-forget,
 * so a failing write and an empty site were indistinguishable. Recording on the
 * server cannot be blocked, and the error is now actually read.
 *
 * Referrer falls back to the campaign tag, because most ad platforms strip the
 * Referer header and paid traffic would otherwise be unattributable.
 */
export async function recordPageView(req: Request): Promise<void> {
  const path = req.path.slice(0, 200);
  if (!path.startsWith("/")) return;
  const ua = String(req.headers["user-agent"] ?? "").slice(0, 200) || null;
  let referrer = String(req.headers["referer"] ?? "").slice(0, 300) || null;
  const campaign = String(req.query.utm_source ?? req.query.src ?? "").slice(0, 60);
  if (!referrer && campaign) referrer = `campaign:${campaign}`;

  const { error } = await supabase.from("page_views").insert({ path, referrer, ua });
  if (error) logger.warn({ err: error, path }, "page view insert failed");
}

/**
 * Public beacon, kept for client-routed dashboard views that have no server
 * request to hang a record off. Same rule: read the error.
 */
export async function recordView(req: Request, res: Response) {
  res.status(204).end();
  if (!allow(`pv:${req.ip}`, 60, 60_000)) return;
  const path = String(req.query.p ?? "").slice(0, 200);
  if (!path.startsWith("/")) return;
  const referrer = String(req.query.r ?? "").slice(0, 300) || null;
  const ua = String(req.headers["user-agent"] ?? "").slice(0, 200) || null;
  const { error } = await supabase.from("page_views").insert({ path, referrer, ua });
  if (error) logger.warn({ err: error, path }, "page view beacon insert failed");
}

export const metricsRouter = Router();

// GET /api/metrics/summary — owner only: daily views, top pages/referrers,
// and the funnel counts that matter (signups, connected inboxes).
metricsRouter.get("/summary", async (req, res) => {
  if (userEmail(res)?.toLowerCase() !== env.CONTACT_TO_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: "not available" });
  }
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const [{ data: views }, { count: signups }, { count: inboxes }] = await Promise.all([
    supabase.from("page_views").select("path, referrer, created_at").gte("created_at", since),
    supabase.from("profiles").select("user_id", { count: "exact", head: true }),
    supabase.from("email_accounts").select("id", { count: "exact", head: true }),
  ]);

  const byDay = new Map<string, number>();
  const byPath = new Map<string, number>();
  const byRef = new Map<string, number>();
  for (const v of views ?? []) {
    const day = String(v.created_at).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    byPath.set(v.path as string, (byPath.get(v.path as string) ?? 0) + 1);
    if (v.referrer) {
      let host = "";
      try {
        host = new URL(v.referrer as string).hostname;
      } catch {
        host = String(v.referrer).slice(0, 60);
      }
      if (host && !host.includes("tryoneinbox")) byRef.set(host, (byRef.get(host) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => ({ key: k, views: n }));

  res.json({
    days,
    total_views: (views ?? []).length,
    per_day: [...byDay.entries()].sort().map(([day, n]) => ({ day, views: n })),
    top_pages: top(byPath),
    top_referrers: top(byRef),
    signups_all_time: signups ?? 0,
    connected_inboxes_all_time: inboxes ?? 0,
  });
});
