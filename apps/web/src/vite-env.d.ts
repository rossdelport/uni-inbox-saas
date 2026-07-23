// Self-contained replacement for vite/client's ImportMeta typing: build
// machines have failed to resolve the vite package's ambient types, and all
// we actually use is import.meta.env with these three variables.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_URL?: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
