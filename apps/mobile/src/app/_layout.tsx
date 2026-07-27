import { useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/lib/auth";
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
