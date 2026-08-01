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

      const configuredUrls = [
        ["VITE_SUPABASE_URL", process.env.VITE_SUPABASE_URL],
        ["VITE_API_URL", process.env.VITE_API_URL],
      ] as const;
      const unsafe = configuredUrls.flatMap(([key, value]) => {
        if (!value) return [];
        try {
          const host = new URL(value).hostname.toLowerCase();
          return host === "localhost" ||
            host === "127.0.0.1" ||
            host === "0.0.0.0" ||
            host.endsWith(".invalid")
            ? [key]
            : [];
        } catch {
          return [key];
        }
      });
      if (unsafe.length) {
        throw new Error(
          `Refusing to build: ${unsafe.join(" and ")} contains a local, placeholder, or invalid URL. ` +
            `A production bundle must only contain publicly reachable endpoints.`,
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
