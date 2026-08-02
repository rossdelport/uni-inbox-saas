import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

// The slide-up drawer everything modal-ish lives in: compose, connect an
// account, account editing.
//
// Modal's own animationType="slide" would do the movement, but it cannot
// fade a backdrop underneath, and dropping a panel onto a hard black
// rectangle looks cheap. So the Modal itself is instant and this drives both
// the translate and the backdrop opacity together.

const SCREEN_H = Dimensions.get("window").height;

export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
  /** Fraction of the screen the sheet occupies. Compose wants nearly all of
   *  it; a short confirmation does not. */
  heightRatio = 0.92,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  heightRatio?: number;
}) {
  const t = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  // Modal renders nothing while visible is false, so driving it straight from
  // the prop meant the sheet vanished instantly on close and only ever
  // animated in one direction. Staying mounted until the slide-down finishes
  // is what makes it read as a drawer rather than a popup.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, anim]);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_H * heightRatio, 0],
  });

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.fill}>
        <Animated.View style={[styles.backdrop, { opacity: anim }]}>
          <Pressable style={styles.fill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              height: SCREEN_H * heightRatio,
              backgroundColor: t.card,
              transform: [{ translateY }],
            },
          ]}
        >
          <KeyboardAvoidingView
            style={styles.fill}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={[styles.header, { borderBottomColor: t.line }]}>
              <View style={[styles.grabber, { backgroundColor: t.line }]} />
              <View style={styles.headerRow}>
                <View style={styles.headerText}>
                  <Text style={[styles.title, { color: t.text }]}>{title}</Text>
                  {subtitle ? (
                    <Text style={[styles.subtitle, { color: t.sub }]}>{subtitle}</Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.close,
                    { backgroundColor: t.chipBg, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.closeText, { color: t.sub }]}>✕</Text>
                </Pressable>
              </View>
            </View>

            <SafeAreaView style={styles.fill} edges={["bottom"]}>
              {children}
            </SafeAreaView>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    shadowColor: "#0A2540",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  },
  header: { paddingHorizontal: 18, paddingBottom: 14, borderBottomWidth: 1 },
  grabber: { width: 42, height: 5, borderRadius: 3, alignSelf: "center", marginTop: 9, marginBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 21, fontWeight: "800", letterSpacing: -0.4 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 14, fontWeight: "700" },
});
