import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { allow } from "../lib/rateLimit.js";

// Public contact-form endpoint for the marketing site. Sends the message to
// CONTACT_TO_EMAIL via Resend; mounted BEFORE the auth gate in index.ts.
const input = z.object({
  name: z.string().max(200).optional().default(""),
  email: z.string().email().max(320),
  message: z.string().min(1).max(5000),
});

export const contactRouter = Router();

contactRouter.post("/", async (req, res) => {
  if (!allow(`contact:${req.ip}`, 5, 3_600_000)) {
    return res.status(429).json({ error: "Too many messages, try again later." });
  }

  const parsed = input.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Fill in a valid email and a message." });
  }
  const { name, email, message } = parsed.data;

  if (!env.RESEND_API_KEY) {
    logger.warn("contact form hit but RESEND_API_KEY is not configured");
    return res.status(503).json({ error: "Messaging is not set up yet. Email us instead." });
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM_EMAIL,
        to: [env.CONTACT_TO_EMAIL],
        reply_to: email,
        subject: `Uni-Inbox contact: ${name || email}`,
        text: `From: ${name || "(no name)"} <${email}>\n\n${message}`,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      logger.error({ status: r.status, body: body.slice(0, 500) }, "resend send failed");
      return res.status(502).json({ error: "Could not send right now, try again in a minute." });
    }
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "contact send error");
    return res.status(502).json({ error: "Could not send right now, try again in a minute." });
  }
});
