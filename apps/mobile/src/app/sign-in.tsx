import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandMark } from "@/components/BrandMark";
import { useSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";

// Sign-in only, no signup: Apple Guideline 3.1.1 forbids selling digital
// subscriptions outside IAP, so accounts (and plans) are created on the web
// and the app never links to a purchase. Same pattern Netflix and Spotify
// ship. Password auth only here; the web dashboard handles resets.

export default function SignIn() {
  const t = useTheme();
  const { session, loading } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Redirect href="/" />;
  if (loading) return null;

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (err) {
      setError(
        err.message === "Invalid login credentials"
          ? "That email and password don't match."
          : err.message,
      );
      setBusy(false);
    }
    // On success the session listener redirects; leaving busy=true avoids a
    // flash of the enabled button during the transition.
  };

  const canSubmit = email.trim().length > 3 && password.length > 0 && !busy;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: "#EAF3FF" }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
          <BrandMark size={48} />
          <Text style={[styles.heading, { color: t.text }]}>Welcome back</Text>
          <Text style={[styles.tagline, { color: t.sub }]}>Every inbox, one calm place.</Text>

          <View style={styles.form}>
            <TextInput
              style={[styles.input, { backgroundColor: t.card, color: t.text, borderColor: t.line }]}
              placeholder="Email"
              placeholderTextColor={t.faint}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              value={email}
              onChangeText={setEmail}
              editable={!busy}
            />
            <TextInput
              style={[styles.input, { backgroundColor: t.card, color: t.text, borderColor: t.line }]}
              placeholder="Password"
              placeholderTextColor={t.faint}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void signIn()}
              editable={!busy}
            />
            {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
            <Pressable
              onPress={() => void signIn()}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: canSubmit ? t.accent : t.chipBg,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.buttonText, { color: canSubmit ? "#fff" : t.faint }]}>
                  Sign in
                </Text>
              )}
            </Pressable>
          </View>

          <View style={[styles.privacy, { backgroundColor: "#F0FAF4", borderColor: "#C5E8D0" }]}>
            <Text style={[styles.privacyTitle, { color: "#0A2540" }]}>Your mail stays private</Text>
            <Text style={[styles.privacyBody, { color: t.sub }]}>We encrypt your mailbox details and never sell your mail.</Text>
          </View>

          <Text style={[styles.footer, { color: t.faint }]}>
            Use the same OneInbox account you use on the web.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, justifyContent: "center" },
  card: {
    margin: 20,
    padding: 24,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "stretch",
    shadowColor: "#0C7DFF",
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 4,
  },
  heading: { fontSize: 32, fontWeight: "800", letterSpacing: -1, marginTop: 24 },
  tagline: { fontSize: 15, marginTop: 5, marginBottom: 26 },
  form: { gap: 11 },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 15,
    fontSize: 15,
  },
  error: { fontSize: 13, fontWeight: "500", paddingHorizontal: 2 },
  button: {
    height: 52,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    shadowColor: "#0C7DFF",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  buttonText: { fontSize: 16, fontWeight: "700" },
  privacy: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 22, gap: 4 },
  privacyTitle: { fontSize: 14, fontWeight: "800" },
  privacyBody: { fontSize: 12.5, lineHeight: 18 },
  footer: { fontSize: 12.5, textAlign: "center", marginTop: 22, lineHeight: 18 },
});
