import { Router } from "express";
import { z } from "zod";
import { userId } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { supabase } from "../lib/supabase.js";
import { getStripe } from "../services/stripeBilling.js";

export const accountRouter = Router();

// Permanent self-service deletion for App Store policy and user control.
// Stripe subscriptions are cancelled before the auth row is removed so an
// account can never disappear while its card keeps billing. Auth deletion
// cascades through profiles, mailboxes, messages, threads and sync state.
accountRouter.delete("/", async (req, res) => {
  const parsed = z.object({ confirm: z.literal("DELETE") }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Type DELETE to confirm." });

  const uid = userId(res);
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("stripe_subscription_id, ai_subscription_id")
    .eq("user_id", uid)
    .maybeSingle();
  if (profileError) {
    logger.error({ err: profileError, uid }, "self-delete: profile lookup failed");
    return res.status(502).json({ error: "Could not prepare account deletion. Nothing was deleted." });
  }

  const subscriptions = [profile?.stripe_subscription_id, profile?.ai_subscription_id].filter(
    (id): id is string => typeof id === "string" && id.startsWith("sub_"),
  );
  const uniqueSubscriptions = [...new Set(subscriptions)];
  for (const subId of uniqueSubscriptions) {
    try {
      await getStripe().subscriptions.cancel(subId);
    } catch (err) {
      logger.error({ err, uid, subId }, "self-delete: subscription cancellation failed");
      return res.status(502).json({
        error: "We could not stop billing, so your account was not deleted. Please contact support.",
      });
    }
  }

  const { error } = await supabase.auth.admin.deleteUser(uid);
  if (error) {
    logger.error({ err: error, uid }, "self-delete: auth deletion failed");
    return res.status(502).json({ error: "Account deletion failed. Please contact support." });
  }
  logger.info({ uid, cancelledSubscriptions: uniqueSubscriptions.length }, "user deleted own account");
  res.json({ ok: true });
});
