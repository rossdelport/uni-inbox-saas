import { StyleSheet, Text, View } from "react-native";
import { tint } from "@/lib/colors";

// Initial in a soft wash of the account color, ringed by a faint stroke.
// Same treatment as the web dashboard's avatars.
export function SenderAvatar({
  label,
  color,
  size = 38,
}: {
  label: string;
  color: string;
  size?: number;
}) {
  const t = tint(color);
  const initial = (label.trim()[0] ?? "?").toUpperCase();
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: t.backgroundColor,
          borderColor: t.borderColor,
        },
      ]}
    >
      <Text style={{ color: t.fg, fontSize: size * 0.42, fontWeight: "600" }}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
});
