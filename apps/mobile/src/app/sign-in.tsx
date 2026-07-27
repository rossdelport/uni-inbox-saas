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
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.wrap}>
          <Text style={[styles.brand, { color: t.text }]}>ONEINBOX</Text>
          <Text style={[styles.tagline, { color: t.sub }]}>
            Every project inbox, one quiet list.
          </Text>

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

          <Text style={[styles.footer, { color: t.faint }]}>
            New to OneInbox? Create your account on the web first.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  wrap: { flex: 1, justifyContent: "center", padding: 28, gap: 8 },
  brand: { fontSize: 24, fontWeight: "800", letterSpacing: 5, textAlign: "center" },
  tagline: { fontSize: 14, textAlign: "center", marginBottom: 24 },
  form: { gap: 10 },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  error: { fontSize: 13, fontWeight: "500", paddingHorizontal: 2 },
  button: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonText: { fontSize: 16, fontWeight: "700" },
  footer: { fontSize: 13, textAlign: "center", marginTop: 28 },
});
