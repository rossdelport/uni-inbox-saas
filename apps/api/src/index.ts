import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { requireAuth } from "./lib/auth.js";
import { accountsRouter } from "./routes/accounts.js";
import { inboxRouter } from "./routes/inbox.js";
import { messagesRouter } from "./routes/messages.js";
import { sendRouter } from "./routes/send.js";
import { billingRouter } from "./routes/billing.js";

const app = express();
// Railway terminates TLS at its proxy; trust exactly one hop so req.ip is the
// address Railway saw (rightmost XFF entry), not a client-spoofable value.
app.set("trust proxy", 1);

// Stripe webhook — MUST be registered before express.json(): signature
// verification needs the raw, unparsed body. Public (Stripe calls it), the
// signature is the auth.
app.post("/api/billing/webhook", express.raw({ type: () => true }), async (req, res) => {
  try {
    const { verifyWebhook, handleWebhookEvent } = await import("./services/stripeBilling.js");
    const event = verifyWebhook(req.body as Buffer, String(req.headers["stripe-signature"] ?? ""));
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    logger.warn({ err }, "stripe webhook rejected");
    res.status(400).json({ error: "invalid webhook" });
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(
  pinoHttp({
    logger,
    // Request logs must never include bodies: /api/accounts carries passwords.
    serializers: { req: (req) => ({ method: req.method, url: req.url }) },
  }),
);

// CORS. Auth is bearer-token (not cookies), so CORS isn't the security gate —
// the JWT is. When CORS_ORIGINS is set we allow those exact origins plus any
// *.vercel.app deployment of this app (preview URLs) and localhost; unset
// means allow all.
const corsAllow = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : null;
app.use(
  cors({
    origin: corsAllow
      ? (origin, cb) => {
          if (!origin) return cb(null, true); // curl / server-to-server
          let host = "";
          try {
            host = new URL(origin).hostname;
          } catch {
            /* malformed origin */
          }
          const ok =
            corsAllow.includes(origin) ||
            host.endsWith(".vercel.app") ||
            host === "localhost" ||
            host === "127.0.0.1";
          cb(null, ok);
        }
      : true,
  }),
);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Everything below requires a valid Supabase Auth JWT from the dashboard.
app.use("/api", requireAuth);
app.use("/api/billing", billingRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/inbox", inboxRouter);
app.use("/api", messagesRouter); // /api/threads/:id, /api/messages/:id/attachments/:partId
app.use("/api", sendRouter); // /api/threads/:id/reply, /api/messages/send

// ONE Railway service hosts the whole product on one origin:
//   /            -> marketing site (repo-root site/, static Framer export)
//   /app         -> dashboard SPA (repo-root dist/, built with base /app/)
//   /api, /health-> this API + the sync worker in the same process
// The committed dist calls /api same-origin, so there is no CORS config at all.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const webDist = resolve(repoRoot, "dist");
const marketing = resolve(repoRoot, "site");

if (existsSync(webDist)) {
  app.use("/app", express.static(webDist, { index: "index.html", maxAge: "1h" }));
  // SPA fallback: /app/anything renders the app shell.
  app.get(["/app", "/app/*"], (_req, res) => {
    res.sendFile(resolve(webDist, "index.html"));
  });
  logger.info({ webDist }, "serving dashboard at /app");
}

if (existsSync(marketing)) {
  app.use(express.static(marketing, { extensions: ["html"], maxAge: "1h" }));
  // Unknown non-API pages get the site's own 404.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health") return next();
    res.status(404).sendFile(resolve(marketing, "404.html"));
  });
  logger.info({ marketing }, "serving marketing site at /");
} else if (existsSync(webDist)) {
  // No marketing site checked in: fall back to the dashboard at the root.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health") return next();
    res.sendFile(resolve(webDist, "index.html"));
  });
}

app.listen(env.PORT, () => {
  logger.info(`API listening on :${env.PORT}`);
});
