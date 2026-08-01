// Keep the app logo local so the dashboard branding does not depend on an
// external image host. Vite serves public assets beneath the app's /app base.
export const LOGO_SRC = "/app/logo.png";
export const MAIL_SRC = "https://framerusercontent.com/images/OEgOgKnJfYyJzdDPysfJV8oaYI.png";

// Provider dot colors (mirrors the marketing site's provider pills).
export const PROVIDER_COLORS: Record<string, string> = {
  gmail: "#EA4335",
  icloud: "#3693F3",
  porkbun: "#EF5DA8",
  custom: "#00B050",
};
