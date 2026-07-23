import { createClient } from "@supabase/supabase-js";

// Anon key only — RLS restricts the web app to read access; all writes go
// through the API with the service role.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
