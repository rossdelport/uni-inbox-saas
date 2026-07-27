import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

// Filter pill: view tabs and account filters. Optional leading color dot and
// trailing count badge.
export function Chip({
  label,
  active,
  onPress,
  dotColor,
  count,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  dotColor?: string;
  count?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? t.chipActiveBg : t.chipBg, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
      <Text style={[styles.label, { color: active ? t.chipActiveText : t.sub }]} numberOfLines={1}>
        {label}
      </Text>
      {count ? (
        <View style={[styles.count, { backgroundColor: active ? `${t.chipActiveText}26` : t.accentSoft }]}>
          <Text style={[styles.countText, { color: active ? t.chipActiveText : t.accent }]}>
            {count > 99 ? "99+" : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 13, fontWeight: "600", maxWidth: 140 },
  count: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 11, fontWeight: "700" },
});
