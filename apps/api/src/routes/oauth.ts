import { Router, type Request, type Response } from "express";
import { env } from "../config/env.js";
import { userId } from "../lib/auth.js";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { encryptCredentials } from "../lib/crypto.js";
import { getBilling } from "../lib/plans.js";
import { PALETTE } from "./accounts.js";
import { wakeAccount } from "../services/imapSync.js";
import {
  appOrigin,
  emailFromIdToken,
  exchangeCode,
  OAUTH_PROVIDERS,
  oauthConfigured,
  signState,
  verifyState,
  type OauthProvider,
} from "../services/oauthTokens.js";

// Google / Microsoft mail OAuth. Two halves:
//  - authed half (mounted behind requireAuth): which providers are live, and
//    "start" which mints the signed-state authorize URL for the browser.
//  - public half: the provider redirects the browser to the callback with a
//    code; the signed state ties it back to the user.

export const oauthRouter = Router();

oauthRouter.get("/providers", (_req, res) => {
  res.json({ google: oauthConfigured("google"), microsoft: oauthConfigured("microsoft") });
});

oauthRouter.post("/:provider/start", (req, res) => {
  const provider = req.params.provider as OauthProvider;
  if (provider !== "google" && provider !== "microsoft") {
    return res.status(404).json({ error: "unknown provider" });
  }
  if (!oauthConfigured(provider)) {
    return res.status(503).json({ error: "This sign-in method is not set up yet." });
  }
  const c = OAUTH_PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: c.clientId() ?? "",
    redirect_uri: `${appOrigin()}/api/oauth/${provider}/callback`,
    response_type: "code",
    scope: c.scope,
    state: signState(userId(res), provider),
  });
  if (provider === "google") {
    params.set("access_type", "offline");
    params.set("prompt", "consent"); // guarantees a refresh token every time
  } else {
    params.set("prompt", "select_account");
  }
  res.json({ url: `${c.authUrl}?${params.toString()}` });
});

/** Public callback (mounted before the auth gate in index.ts). */
export async function oauthCallback(req: Request, res: Response) {
  const provider = req.params.provider as OauthProvider;
  const back = (q: string) => res.redirect(`${env.DASHBOARD_URL}?${q}`);
  if (provider !== "google" && provider !== "microsoft") return back("connect_error=unknown_provider");

  const state = verifyState(String(req.query.state ?? ""));
  if (!state || state.provider !== provider) return back("connect_error=bad_state");
  if (req.query.error) return back(`connect_error=${encodeURIComponent(String(req.query.error))}`);

  const code = String(req.query.code ?? "");
  if (!code) return back("connect_error=no_code");

  try {
    const tokens = await exchangeCode(provider, code);
    const email = emailFromIdToken(tokens.id_token);
    if (!email) return back("connect_error=no_email");
    if (!tokens.refresh_token) return back("connect_error=no_refresh_token");

    const uid = state.uid;
    const c = OAUTH_PROVIDERS[provider];
    const authMethod = provider === "google" ? "oauth_google" : "oauth_microsoft";
    const credentials_enc = encryptCredentials({ refresh_token: tokens.refresh_token });

    // Re-auth of an existing account updates in place (no cap check needed).
    const { data: existing } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("owner_id", uid)
      .eq("email_address", email)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("email_accounts")
        .update({
          credentials_enc,
          auth_method: authMethod,
          status: "active",
          last_error: null,
          consecutive_failures: 0,
          next_sync_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      await wakeAccount(existing.id as string);
      return back(`connected=${encodeURIComponent(email)}`);
    }

    const billing = await getBilling(uid);
    const { count } = await supabase
      .from("email_accounts")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", uid)
      .neq("status", "disabled");
    if ((count ?? 0) >= billing.plan.maxInboxes) return back("connect_error=plan_full");

    const { data: created, error } = await supabase
      .from("email_accounts")
      .insert({
        owner_id: uid,
        label: c.label,
        email_address: email,
        color: PALETTE[(count ?? 0) % PALETTE.length],
        provider_preset: c.presetId,
        auth_method: authMethod,
        imap_host: c.imap.host,
        imap_port: c.imap.port,
        smtp_host: c.smtp.host,
        smtp_port: c.smtp.port,
        smtp_security: c.smtp.security,
        imap_username: email,
        credentials_enc,
        status: "active",
        next_sync_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !created) {
      logger.error({ error }, "oauth account insert failed");
      return back("connect_error=save_failed");
    }
    await wakeAccount(created.id as string);
    return back(`connected=${encodeURIComponent(email)}`);
  } catch (err) {
    logger.error({ err, provider }, "oauth callback failed");
    return back("connect_error=exchange_failed");
  }
}
