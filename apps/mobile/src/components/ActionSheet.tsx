import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

// A plain modal sheet rather than ActionSheetIOS + Alert.
//
// The obvious approach was ActionSheetIOS on iOS with Alert.alert as the
// fallback, but RN's Alert silently slices Android down to three buttons
// (Libraries/Alert/Alert.js), so a six-action triage menu lost half its
// actions AND its Cancel, leaving an undismissable dialog. One component
// that renders the same everywhere is both less code and less to get wrong.

export interface SheetAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

export function ActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string | null;
  actions: SheetAction[];
  onClose: () => void;
}) {
  const t = useTheme();

  const pick = (a: SheetAction) => {
    // Close first so the sheet is never left standing over a screen the
    // action navigated away from.
    onClose();
    a.onPress();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Taps inside the sheet must not fall through to the backdrop. */}
        <Pressable style={styles.sheetWrap} onPress={() => {}}>
          <SafeAreaView edges={["bottom"]}>
            <View style={[styles.group, { backgroundColor: t.card }]}>
              {title ? (
                <View style={[styles.titleRow, { borderBottomColor: t.line }]}>
                  <Text numberOfLines={2} style={[styles.title, { color: t.faint }]}>
                    {title}
                  </Text>
                </View>
              ) : null}
              {actions.map((a, i) => (
                <Pressable
                  key={a.label}
                  onPress={() => pick(a)}
                  style={({ pressed }) => [
                    styles.action,
                    {
                      backgroundColor: pressed ? t.chipBg : "transparent",
                      borderTopWidth: i === 0 && !title ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: t.line,
                    },
                  ]}
                >
                  <Text
                    style={[styles.actionText, { color: a.destructive ? t.danger : t.accent }]}
                  >
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.group,
                styles.cancel,
                { backgroundColor: t.card, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.cancelText, { color: t.text }]}>Cancel</Text>
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheetWrap: { padding: 10, gap: 8 },
  group: { borderRadius: 14, overflow: "hidden" },
  titleRow: { paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 12, textAlign: "center" },
  action: { paddingVertical: 15, alignItems: "center" },
  actionText: { fontSize: 17, fontWeight: "500" },
  cancel: { marginTop: 8, paddingVertical: 15, alignItems: "center" },
  cancelText: { fontSize: 17, fontWeight: "700" },
});
