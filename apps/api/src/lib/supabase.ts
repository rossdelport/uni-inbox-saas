import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

// Service-role client — bypasses RLS. Server-side only; never expose this key.
// Scoped to the uni_inbox schema: this project shares its Supabase instance
// with ibookshelf, and the schema is the isolation boundary between them.
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: env.SUPABASE_DB_SCHEMA },
  },
);
