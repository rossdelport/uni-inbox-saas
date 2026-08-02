import { Router } from "express";
import { z } from "zod";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";

export const contactsRouter = Router();

interface ContactRow {
  email: string;
  display_name: string | null;
  frequency: number;
  last_seen_at: string;
  account_ids: string[] | null;
}

const querySchema = z.object({
  q: z.string().trim().max(80).default(""),
  account: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

/**
 * Contact suggestions built from envelope metadata in the caller's own
 * synced mail. This endpoint deliberately does not return message content or
 * provider address-book data, and the owner id comes only from the JWT.
 */
contactsRouter.get("/", async (req, res) => {
  const parsed = querySchema.safeParse({
    q: typeof req.query.q === "string" ? req.query.q : "",
    account: typeof req.query.account === "string" ? req.query.account : undefined,
    limit: req.query.limit ?? 8,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "invalid contact search" });
    return;
  }

  // PostgREST pattern operators treat these as wildcards or syntax. Search
  // terms are only hints, so stripping them is preferable to allowing a
  // malformed term to widen the query or fail the request.
  const q = parsed.data.q.replace(/[%,()_]/g, " ").replace(/\s+/g, " ").trim();
  const { data, error } = await supabase.rpc("search_contacts", {
    p_owner: userId(res),
    p_query: q,
    p_account: parsed.data.account ?? null,
    p_limit: parsed.data.limit,
  });
  if (error) {
    res.status(500).json({ error: "could not load contacts" });
    return;
  }

  const rows = (data ?? []) as ContactRow[];
  res.json({
    contacts: rows.map((contact) => ({
      email: String(contact.email),
      display_name: contact.display_name ? String(contact.display_name) : null,
      frequency: Number(contact.frequency) || 0,
      last_seen_at: String(contact.last_seen_at),
      account_ids: Array.isArray(contact.account_ids) ? contact.account_ids.map(String) : [],
    })),
  });
});
