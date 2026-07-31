import { Router } from "express";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import {
  AiCapError,
  aiConfigured,
  getCachedSummary,
  summarizeThread,
} from "../services/aiSummary.js";

// AI endpoints (mounted under /api/ai, behind requireAuth). The paid-add-on
// gate lives HERE, before any code that can spend tokens: a user without the
// add-on can never trigger a model call, whatever the client sends.

export const aiRouter = Router();

const AI_ACTIVE = new Set(["trialing", "active", "past_due"]);

async function hasAiAddon(uid: string): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("ai_status")
    .eq("user_id", uid)
    .maybeSingle();
  return AI_ACTIVE.has((data?.ai_status as string | null) ?? "");
}

// GET /api/ai/summary/:threadId — the cached summary, if still fresh. Free:
// serves only what a previous paid call produced.
aiRouter.get("/summary/:threadId", async (req, res) => {
  const uid = userId(res);
  if (!(await hasAiAddon(uid))) {
    return res.status(402).json({ error: "AI summaries are an add-on.", code: "ai_addon_required" });
  }
  const cached = await getCachedSummary(uid, req.params.threadId);
  res.json({ summary: cached });
});

// POST /api/ai/summary/:threadId — summarize now (cache-first).
aiRouter.post("/summary/:threadId", async (req, res) => {
  const uid = userId(res);
  if (!(await hasAiAddon(uid))) {
    return res.status(402).json({ error: "AI summaries are an add-on.", code: "ai_addon_required" });
  }
  if (!aiConfigured()) {
    return res.status(503).json({ error: "AI summaries are not configured yet. Tell the founder." });
  }
  try {
    const result = await summarizeThread(uid, req.params.threadId);
    res.json({ summary: result });
  } catch (err) {
    if (err instanceof AiCapError) {
      return res.status(429).json({ error: err.message, code: "ai_daily_cap" });
    }
    logger.error({ err, uid, threadId: req.params.threadId }, "summary failed");
    res.status(502).json({ error: "The summary did not come back. Try again in a moment." });
  }
});
