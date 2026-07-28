import { useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ACCOUNT_COLORS } from "@/lib/colors";
import { useTheme } from "@/lib/theme";

// Form primitives shared by the connect, compose and settings sheets, so
// every input in the app has the same height, radius and focus treatment.

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.sub }]}>{label}</Text>
      {children}
      {hint ? <Text style={[styles.hint, { color: t.faint }]}>{hint}</Text> : null}
    </View>
  );
}

export function Input(props: ComponentProps<typeof TextInput>) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.faint}
      {...props}
      style={[
        styles.input,
        { backgroundColor: t.card, color: t.text, borderColor: t.line },
        props.style,
      ]}
    />
  );
}

/** Password field with a show/hide toggle, mirroring the web PasswordInput.
 *  App passwords are long random strings and typing one blind is miserable. */
export function PasswordField(props: ComponentProps<typeof TextInput>) {
  const t = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <View>
      <Input
        {...props}
        secureTextEntry={!shown}
        autoCapitalize="none"
        autoCorrect={false}
        style={[{ paddingRight: 58 }, props.style]}
      />
      <Pressable
        onPress={() => setShown((v) => !v)}
        hitSlop={8}
        style={({ pressed }) => [styles.reveal, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.revealText, { color: t.accent }]}>{shown ? "Hide" : "Show"}</Text>
      </Pressable>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  const t = useTheme();
  const bg =
    variant === "primary" ? (disabled ? t.chipBg : t.accent) : variant === "danger" ? "transparent" : t.chipBg;
  const fg =
    variant === "primary"
      ? disabled
        ? t.faint
        : "#fff"
      : variant === "danger"
        ? t.danger
        : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderWidth: variant === "danger" ? StyleSheet.hairlineWidth : 0,
          borderColor: t.danger,
          opacity: pressed || busy ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonText, { color: fg }]}>{busy ? "Working…" : label}</Text>
    </Pressable>
  );
}

export function ColorDots({ value, onChange }: { value?: string; onChange: (c: string) => void }) {
  const t = useTheme();
  return (
    <View style={styles.dots}>
      {ACCOUNT_COLORS.map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          style={[
            styles.dot,
            {
              backgroundColor: c,
              borderColor: value === c ? t.text : "transparent",
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },
  hint: { fontSize: 12, lineHeight: 17 },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  reveal: { position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center" },
  revealText: { fontSize: 13, fontWeight: "700" },
  button: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  buttonText: { fontSize: 15, fontWeight: "700" },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2.5 },
});
