import { Router } from "express";
import { z } from "zod";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

// Snippets CRUD. Mounted under /api/snippets behind requireAuth. Service-role
// writes, so every mutation re-checks ownership explicitly.

export const snippetsRouter = Router();

const MAX_SNIPPETS = 50;

const snippetInput = z.object({
  // The thing typed after ";" in the composer: short, no spaces.
  shortcut: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[a-z0-9_-]+$/i, "Shortcuts are letters, numbers, - and _ only."),
  name: z.string().trim().min(1).max(60),
  body_text: z.string().min(1).max(20_000),
  body_html: z.string().max(100_000).optional(),
});

snippetsRouter.get("/", async (_req, res) => {
  const uid = userId(res);
  const { data, error } = await supabase
    .from("snippets")
    .select("id, shortcut, name, body_text, body_html, created_at, updated_at")
    .eq("owner_id", uid)
    .order("shortcut", { ascending: true });
  if (error) {
    logger.error({ err: error, uid }, "snippets list failed");
    return res.status(502).json({ error: "Could not load snippets." });
  }
  res.json({ snippets: data ?? [] });
});

snippetsRouter.post("/", async (req, res) => {
  const uid = userId(res);
  const parsed = snippetInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "invalid snippet" });
  }
  const { count } = await supabase
    .from("snippets")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", uid);
  if ((count ?? 0) >= MAX_SNIPPETS) {
    return res.status(400).json({ error: `You can keep ${MAX_SNIPPETS} snippets. Remove one first.` });
  }
  const { data, error } = await supabase
    .from("snippets")
    .insert({ owner_id: uid, ...parsed.data, shortcut: parsed.data.shortcut.toLowerCase() })
    .select("id, shortcut, name, body_text, body_html, created_at, updated_at")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "You already have a snippet with that shortcut." });
    }
    logger.error({ err: error, uid }, "snippet create failed");
    return res.status(502).json({ error: "Could not save the snippet." });
  }
  res.status(201).json(data);
});

snippetsRouter.patch("/:id", async (req, res) => {
  const uid = userId(res);
  const parsed = snippetInput.partial().safeParse(req.body ?? {});
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "invalid snippet" });
  }
  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (typeof patch.shortcut === "string") patch.shortcut = patch.shortcut.toLowerCase();
  const { data, error } = await supabase
    .from("snippets")
    .update(patch)
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "You already have a snippet with that shortcut." });
    }
    logger.error({ err: error, uid }, "snippet update failed");
    return res.status(502).json({ error: "Could not update the snippet." });
  }
  if (!data) return res.status(404).json({ error: "snippet not found" });
  res.json({ ok: true });
});

snippetsRouter.delete("/:id", async (req, res) => {
  const uid = userId(res);
  const { data, error } = await supabase
    .from("snippets")
    .delete()
    .eq("id", req.params.id)
    .eq("owner_id", uid)
    .select("id")
    .maybeSingle();
  if (error) {
    logger.error({ err: error, uid }, "snippet delete failed");
    return res.status(502).json({ error: "Could not delete the snippet." });
  }
  if (!data) return res.status(404).json({ error: "snippet not found" });
  res.json({ ok: true });
});
