import "react-native-url-polyfill/auto";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

// Anon key only, same as the web dashboard: RLS restricts reads to the
// signed-in owner and all writes go through the API with the service role.
//
// React Native differences from the web client:
// - sessions persist in AsyncStorage instead of localStorage
// - detectSessionInUrl off (that path reads window.location, which
//   does not exist here)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Token refresh timers do not fire while iOS has the app suspended, so a
// phone that sat in a pocket overnight wakes with an expired token. Refresh
// runs while the app is foregrounded and restarts the moment it becomes
// active again, which refreshes an expired session immediately.
AppState.addEventListener("change", (state) => {
  if (state === "active") void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
