import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { SessionProvider } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";

// Root of the app: session + server-state providers around the router.
// Screens draw their own headers, so the native header stays off globally.

export default function RootLayout() {
  const t = useTheme();
  // useState so the client survives fast refresh instead of being recreated
  // (and dropping the whole cache) on every reload.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
          },
        },
      }),
  );

  // React Query's refetch-on-focus is a browser feature: it listens for
  // window focus events, which never fire in React Native, so every
  // "refresh when they come back" behaviour is simply absent unless the
  // focusManager is driven by hand. Without this, a user who left the app to
  // subscribe on the web came back to a screen that could not re-check their
  // plan short of force-quitting.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status: AppStateStatus) => {
      focusManager.setFocused(status === "active");
    });
    return () => sub.remove();
  }, []);

  // Signing out must not leave one person's mail sitting in the cache for
  // whoever signs in next on the same phone.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") queryClient.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <StatusBar style={t.dark ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: t.bg },
          }}
        />
      </SessionProvider>
    </QueryClientProvider>
  );
}
