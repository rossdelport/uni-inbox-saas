import { Image, StyleSheet, Text, View } from "react-native";

// The same mark used by the web header and the App Store icon. Keeping the
// wordmark in one component stops each native screen from inventing a slightly
// different logo treatment.
const ICON = require("../../assets/icon.png");

export function BrandMark({
  size = 34,
  showWordmark = true,
}: {
  size?: number;
  showWordmark?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      <Image
        source={ICON}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }}
        resizeMode="cover"
      />
      {showWordmark ? <Text style={[styles.wordmark, { fontSize: size * 0.56 }]}>oneinbox</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 9 },
  wordmark: { color: "#0A2540", fontWeight: "800", letterSpacing: -0.5 },
});
