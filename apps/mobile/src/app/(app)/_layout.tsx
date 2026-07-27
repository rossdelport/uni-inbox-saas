import { ActivityIndicator, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useSession } from "@/lib/auth";
import { useBillingState } from "@/lib/queries";
import { useRealtimeInbox } from "@/lib/realtime";
import { PlanGate } from "@/components/PlanGate";
import { useTheme } from "@/lib/theme";

// Everything inside this group requires a session. The realtime inbox
// subscription lives here so it spans every screen, and the plan gate wraps
// the whole group: no active plan, no inbox (managed on the web, never sold
// in the app).

export default function AppLayout() {
  const t = useTheme();
  const { session, loading } = useSession();
  const { data: billing } = useBillingState();
  useRealtimeInbox(session?.user.id ?? null);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const unpaid = Boolean(billing) && billing!.plan !== "monthly" && billing!.plan !== "lifetime";
  if (unpaid) return <PlanGate email={session.user.email ?? ""} />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.bg },
      }}
    />
  );
}
