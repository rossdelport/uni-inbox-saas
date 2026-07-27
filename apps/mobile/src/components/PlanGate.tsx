import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { WEB_URL } from "@/lib/config";
import { useTheme } from "@/lib/theme";

// Shown instead of the app when the signed-in user has no active plan.
// Deliberately NOT the web dashboard's paywall: Apple Guideline 3.1.1 forbids
// selling digital subscriptions outside IAP, so this screen never shows a
// price or a checkout, it just points at the website for account management.
// Revisit the "open website" button before App Store submission (external
// purchase links need an entitlement); for the dev build it is a convenience.
export function PlanGate({ email }: { email: string }) {
  const t = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <Text style={[styles.brand, { color: t.text }]}>ONEINBOX</Text>
      <Text style={[styles.title, { color: t.text }]}>Your plan is not active</Text>
      <Text style={[styles.body, { color: t.sub }]}>
        You are signed in as {email}, but this account does not have an active OneInbox plan.
        Manage your plan on the web at tryoneinbox.co, then come back here.
      </Text>
      <Pressable
        onPress={() => void Linking.openURL(WEB_URL)}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: t.accent, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.buttonText}>Open tryoneinbox.co</Text>
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
  button: {
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  signOut: { padding: 10 },
  signOutText: { fontSize: 14, fontWeight: "500" },
});
