import { Router, type Request, type Response } from "express";
import { env } from "../config/env.js";
import { supabase } from "../lib/supabase.js";
import { userEmail } from "../lib/auth.js";
import { allow } from "../lib/rateLimit.js";

// First-party, cookie-less marketing analytics. The site pages fire a
// sendBeacon to /api/metrics/view with the path in the query string; the
// summary endpoint is for the owner's eyes only.

/** Public beacon (mounted before the auth gate). */
export function recordView(req: Request, res: Response) {
  res.status(204).end();
  if (!allow(`pv:${req.ip}`, 60, 60_000)) return;
  const path = String(req.query.p ?? "").slice(0, 200);
  if (!path.startsWith("/")) return;
  const referrer = String(req.query.r ?? "").slice(0, 300) || null;
  const ua = String(req.headers["user-agent"] ?? "").slice(0, 200) || null;
  void supabase.from("page_views").insert({ path, referrer, ua });
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
