import { Router } from "express";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

// Outbox visibility + undo. Mounted under /api/outbox behind requireAuth.

export const outboxRouter = Router();

const ROW_COLUMNS =
  "id, account_id, thread_id, kind, status, not_before, sent_at, last_error, created_at, payload";

function shape(r: Record<string, unknown>) {
  const p = (r.payload as Record<string, unknown>) ?? {};
  return {
    id: r.id,
    account_id: r.account_id,
    thread_id: r.thread_id,
    kind: r.kind,
    status: r.status,
    not_before: r.not_before,
    sent_at: r.sent_at,
    last_error: r.last_error,
    created_at: r.created_at,
    subject: (p.subject as string | null) ?? null,
    to: (p.to as string[]) ?? [],
  };
}

// GET /api/outbox?thread=<id>       pending rows for one conversation
// GET /api/outbox?scheduled=1       everything queued for later (Sent tab)
outboxRouter.get("/", async (req, res) => {
  const uid = userId(res);
  const thread = typeof req.query.thread === "string" ? req.query.thread : null;
  const scheduled = String(req.query.scheduled ?? "0") === "1";

  let q = supabase
    .from("outbox")
    .select(ROW_COLUMNS)
    .eq("owner_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (thread) {
    // Everything still in motion for the thread, and failures that need a
    // human. Sent rows drop out: the real message row replaces them.
    q = q.eq("thread_id", thread).in("status", ["queued", "sending", "failed", "unknown"]);
  } else if (scheduled) {
    q = q.eq("status", "queued").gt("not_before", new Date().toISOString());
  } else {
    q = q.in("status", ["queued", "sending", "failed", "unknown"]);
  }

  const { data, error } = await q;
  if (error) {
    logger.error({ err: error, uid }, "outbox list failed");
    return res.status(502).json({ error: "Could not load the outbox." });
  }
  res.json({ items: (data ?? []).map((r) => shape(r as Record<string, unknown>)) });
});

// POST /api/outbox/:id/cancel — undo a queued send (or a scheduled one).
// Races the drain fairly: the drain claims with status="queued" as its guard
// and this cancels with the same guard, so exactly one of them wins.
outboxRouter.post("/:id/cancel", async (req, res) => {
  const uid = userId(res);
  const { data, error } = await supabase
    .from("outbox")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .eq("status", "queued")
    .select("id");
  if (error) {
    logger.error({ err: error, uid }, "outbox cancel failed");
    return res.status(502).json({ error: "Could not cancel." });
  }
  if (!data || data.length === 0) {
    return res.status(409).json({ error: "Too late to undo: the message is already on its way." });
  }
  res.json({ ok: true });
});
