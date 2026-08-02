import { randomBytes } from "node:crypto";
import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { allow } from "../lib/rateLimit.js";
import { supabase } from "../lib/supabase.js";

// The waitlist is deliberately handled by the API, rather than from the
// static page straight to Supabase. That keeps the service key, Resend key and
// one-time Stripe promotion-code creation server-side.
export const waitlistRouter = Router();

const shortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

const signupInput = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  source: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/i),
  page_path: z
    .string()
    .trim()
    .regex(/^\/lpwaitlist(?:\/[^?#]*)?\/?$/)
    .max(200)
    .default("/lpwaitlist"),
  utm_source: shortText(100),
  utm_medium: shortText(100),
  utm_campaign: shortText(160),
  utm_content: shortText(160),
  utm_term: shortText(160),
});

const feedbackInput = z.object({
  signup_id: z.string().uuid(),
  feedback_token: z.string().uuid(),
  message: z.string().trim().min(1).max(5000),
});

type WaitlistSignup = {
  id: string;
  email: string;
  feedback_token: string;
  promo_code: string | null;
  email_sent_at: string | null;
  signup_count: number;
};

function externalReferrer(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    // Trim paths and query strings. Marketing reporting needs the traffic
    // source, not someone else's campaign parameters or personal data.
    return `${url.protocol}//${url.host}`.slice(0, 300);
  } catch {
    return null;
  }
}

function stripeClient(): Stripe | null {
  return env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
}

async function createFirstMonthCode(signupId: string): Promise<string | null> {
  const stripe = stripeClient();
  if (!stripe) return null;

  const code = `ONEINBOX-${randomBytes(4).toString("hex").toUpperCase()}`;
  try {
    // One use, 100% off the first invoice. Checkout already permits promotion
    // codes, so a waitlister can redeem this without another custom flow.
    const coupon = await stripe.coupons.create({
      percent_off: 100,
      duration: "once",
      name: "OneInbox waitlist: first month free",
      metadata: { purpose: "waitlist_first_month_free", waitlist_signup_id: signupId },
    });
    const promotion = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id },
      code,
      max_redemptions: 1,
      metadata: { purpose: "waitlist_first_month_free", waitlist_signup_id: signupId },
    });
    return promotion.code ?? code;
  } catch (err) {
    logger.warn({ err, signupId }, "waitlist promotion-code creation failed");
    return null;
  }
}

async function sendCodeEmail(email: string, promoCode: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM_EMAIL,
        to: [email],
        reply_to: env.WAITLIST_CONTACT_EMAIL,
        subject: "You're on the OneInbox waitlist",
        text: [
          "You are on the OneInbox waitlist.",
          "",
          "We are launching very soon and cannot wait for you to join.",
          "",
          `Your first-month-free code: ${promoCode}`,
          "",
          "Keep this email. You can apply the code when you start your OneInbox subscription.",
          "",
          "Questions? Reply to this email or contact ross@tryoneinbox.co.",
        ].join("\n"),
      }),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "waitlist email delivery failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "waitlist email send failed");
    return false;
  }
}

async function deliverCodeIfReady(signup: WaitlistSignup): Promise<{ promoCode: string | null; emailSent: boolean }> {
  if (signup.email_sent_at) return { promoCode: signup.promo_code, emailSent: true };
  // Do not create a code until we know we can email it. A secret first-month
  // discount is useful only if it reaches the person who earned it.
  if (!env.RESEND_API_KEY) return { promoCode: signup.promo_code, emailSent: false };

  let promoCode = signup.promo_code;
  if (!promoCode) {
    promoCode = await createFirstMonthCode(signup.id);
    if (!promoCode) return { promoCode: null, emailSent: false };
    const { error } = await supabase
      .from("waitlist_signups")
      .update({ promo_code: promoCode })
      .eq("id", signup.id);
    if (error) {
      logger.error({ err: error, signupId: signup.id }, "waitlist promo-code save failed");
      return { promoCode: null, emailSent: false };
    }
  }

  const emailSent = await sendCodeEmail(signup.email, promoCode);
  if (emailSent) {
    const { error } = await supabase
      .from("waitlist_signups")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", signup.id);
    if (error) logger.error({ err: error, signupId: signup.id }, "waitlist email status save failed");
  }
  return { promoCode, emailSent };
}

async function findSignup(email: string): Promise<WaitlistSignup | null> {
  const { data, error } = await supabase
    .from("waitlist_signups")
    .select("id, email, feedback_token, promo_code, email_sent_at, signup_count")
    // Emails are normalized to lowercase before validation, so an exact
    // match is both safer and more predictable than a wildcard ilike query.
    .eq("email", email)
    .maybeSingle();
  if (error) {
    logger.error({ err: error }, "waitlist signup lookup failed");
    throw new Error("waitlist lookup failed");
  }
  return data as WaitlistSignup | null;
}

waitlistRouter.post("/", async (req, res) => {
  if (!allow(`waitlist:${req.ip}`, 10, 60 * 60_000)) {
    return res.status(429).json({ error: "Please wait a little before trying again." });
  }

  const parsed = signupInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const input = parsed.data;
  const referrer = externalReferrer(req.get("referer"));
  let signup: WaitlistSignup | null;
  try {
    signup = await findSignup(input.email);
  } catch {
    return res.status(503).json({ error: "The waitlist is taking a short break. Please try again." });
  }

  let alreadyJoined = Boolean(signup);
  if (signup) {
    const { error } = await supabase
      .from("waitlist_signups")
      .update({
        last_source: input.source,
        last_seen_at: new Date().toISOString(),
        signup_count: signup.signup_count + 1,
      })
      .eq("id", signup.id);
    if (error) logger.warn({ err: error, signupId: signup.id }, "waitlist repeat signup update failed");
  } else {
    const { data, error } = await supabase
      .from("waitlist_signups")
      .insert({
        email: input.email,
        source: input.source,
        last_source: input.source,
        page_path: input.page_path,
        referrer,
        utm_source: input.utm_source,
        utm_medium: input.utm_medium,
        utm_campaign: input.utm_campaign,
        utm_content: input.utm_content,
        utm_term: input.utm_term,
      })
      .select("id, email, feedback_token, promo_code, email_sent_at, signup_count")
      .single();

    if (error) {
      // A rapid double submit can race the unique lower(email) index. Treat it
      // exactly like a normal returning visitor, never like a failed signup.
      if (error.code === "23505") {
        try {
          signup = await findSignup(input.email);
          alreadyJoined = true;
        } catch {
          signup = null;
        }
      }
      if (!signup) {
        logger.error({ err: error }, "waitlist signup insert failed");
        return res.status(503).json({ error: "The waitlist is taking a short break. Please try again." });
      }
    } else {
      signup = data as WaitlistSignup;
    }
  }

  if (!signup) return res.status(503).json({ error: "The waitlist is taking a short break. Please try again." });
  const delivery = await deliverCodeIfReady(signup);
  return res.json({
    ok: true,
    already_joined: alreadyJoined,
    signup_id: signup.id,
    feedback_token: signup.feedback_token,
    email_sent: delivery.emailSent,
  });
});

waitlistRouter.post("/feedback", async (req, res) => {
  if (!allow(`waitlist-feedback:${req.ip}`, 5, 60 * 60_000)) {
    return res.status(429).json({ error: "Please wait a little before sending another note." });
  }
  const parsed = feedbackInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please write a short note first." });
  const { signup_id, feedback_token, message } = parsed.data;

  const { data: signup, error: lookupError } = await supabase
    .from("waitlist_signups")
    .select("id, email")
    .eq("id", signup_id)
    .eq("feedback_token", feedback_token)
    .maybeSingle();
  if (lookupError) {
    logger.error({ err: lookupError }, "waitlist feedback lookup failed");
    return res.status(503).json({ error: "Could not send that note right now." });
  }
  if (!signup) return res.status(404).json({ error: "That waitlist session has expired. Email ross@tryoneinbox.co instead." });

  const { error: insertError } = await supabase
    .from("waitlist_feedback")
    .insert({ waitlist_signup_id: signup_id, message });
  if (insertError) {
    logger.error({ err: insertError, signupId: signup_id }, "waitlist feedback insert failed");
    return res.status(503).json({ error: "Could not send that note right now." });
  }

  // A feedback note should still be saved even if email delivery is not set up
  // yet. When it is configured, make replying simple by using their address.
  if (env.RESEND_API_KEY) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.CONTACT_FROM_EMAIL,
          to: [env.WAITLIST_CONTACT_EMAIL],
          reply_to: signup.email,
          subject: "OneInbox waitlist note",
          text: `From: ${signup.email}\n\n${message}`,
        }),
      });
      if (!response.ok) logger.warn({ status: response.status }, "waitlist feedback email delivery failed");
    } catch (err) {
      logger.warn({ err }, "waitlist feedback email send failed");
    }
  }
  return res.json({ ok: true });
});
