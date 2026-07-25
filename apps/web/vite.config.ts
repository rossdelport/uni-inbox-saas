import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite inlines VITE_* values at build time, so a production build started
// without them silently ships a bundle that cannot reach Supabase, and every
// /app route renders blank. dist/ is committed, so that broken bundle would
// then be deployed. Fail the build instead.
function requireSupabaseEnv() {
  return {
    name: "require-supabase-env",
    apply: "build" as const,
    config(_config: unknown, { mode }: { mode: string }) {
      if (mode !== "production") return;
      const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter(
        (k) => !process.env[k],
      );
      if (missing.length) {
        throw new Error(
          `Refusing to build: ${missing.join(" and ")} not set. The bundle would ` +
            `load with no Supabase config and every /app route would render blank. ` +
            `Set them (root .env or the shell) and rebuild.`,
        );
      }
    },
  };
}

export default defineConfig({
  // The dashboard is served at /app on the combined Railway service (the
  // marketing site owns /), so assets and the router live under that base.
  base: "/app/",
  plugins: [requireSupabaseEnv(), react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
});
