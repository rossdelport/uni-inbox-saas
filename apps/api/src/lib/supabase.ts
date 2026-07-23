import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

// Service-role client — bypasses RLS. Server-side only; never expose this key.
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
