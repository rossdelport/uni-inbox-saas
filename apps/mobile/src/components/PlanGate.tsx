import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";

// Shown instead of the app when the signed-in user has no active plan.
// Deliberately NOT the web dashboard's paywall: Apple Guideline 3.1.1 forbids
// selling digital subscriptions outside IAP, so this screen never shows a
// price, checkout, external purchase link or call to action.
export function PlanGate({ email }: { email: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);

  const recheck = () => {
    setChecking(true);
    void qc
      .invalidateQueries({ queryKey: ["billing"] })
      .finally(() => setChecking(false));
  };

  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <Text style={[styles.brand, { color: t.text }]}>ONEINBOX</Text>
      <Text style={[styles.title, { color: t.text }]}>Your plan is not active</Text>
      <Text style={[styles.body, { color: t.sub }]}>
        You are signed in as {email}, but this account does not have an active OneInbox plan.
        If you recently made a change, tap Check again.
      </Text>
      <Pressable
        onPress={recheck}
        disabled={checking}
        style={({ pressed }) => [styles.recheck, { opacity: pressed || checking ? 0.6 : 1 }]}
      >
        {checking ? (
          <ActivityIndicator size="small" color={t.sub} />
        ) : (
          <Text style={[styles.recheckText, { color: t.accent }]}>Check again</Text>
        )}
      </Pressable>
      <Pressable onPress={() => void supabase.auth.signOut()} style={styles.signOut}>
        <Text style={[styles.signOutText, { color: t.sub }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  brand: { fontSize: 18, fontWeight: "800", letterSpacing: 4, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  recheck: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 38, justifyContent: "center" },
  recheckText: { fontSize: 14, fontWeight: "600" },
  signOut: { padding: 10 },
  signOutText: { fontSize: 14, fontWeight: "500" },
});
