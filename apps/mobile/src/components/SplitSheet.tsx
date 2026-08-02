import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import type { SplitClass, ThreadSummary } from "@/lib/types";

const OPTIONS: Array<{ value: SplitClass; label: string; note: string; color: string }> = [
  { value: "important", label: "Important", note: "Keep it in your main inbox", color: "#1769D5" },
  { value: "newsletter", label: "Newsletter", note: "Mailing lists and updates", color: "#A855F7" },
  { value: "other", label: "Other", note: "Receipts, alerts, and automated mail", color: "#E88A00" },
];

export function SplitSheet({
  visible,
  thread,
  onClose,
  onApply,
}: {
  visible: boolean;
  thread: ThreadSummary | null;
  onClose: () => void;
  onApply: (splitClass: SplitClass, remember: "thread" | "sender" | "domain") => void;
}) {
  const t = useTheme();
  const [chosen, setChosen] = useState<SplitClass | null>(null);
  const sender = thread?.from_address ?? null;
  const domain = sender?.split("@")[1] ?? null;
  const selected = OPTIONS.find((option) => option.value === chosen);

  function close() {
    setChosen(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { backgroundColor: t.card }]} onPress={() => {}}>
          {!chosen ? (
            <>
              <Text style={[styles.kicker, { color: t.faint }]}>MOVE THIS CONVERSATION</Text>
              {OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setChosen(option.value)}
                  style={({ pressed }) => [styles.option, { opacity: pressed ? 0.65 : 1 }]}
                >
                  <View style={[styles.dot, { backgroundColor: option.color }]} />
                  <View style={styles.optionBody}>
                    <Text style={[styles.optionTitle, { color: t.text }]}>{option.label}</Text>
                    <Text style={[styles.optionNote, { color: t.faint }]}>{option.note}</Text>
                  </View>
                  <Text style={[styles.chevron, { color: t.faint }]}>›</Text>
                </Pressable>
              ))}
              <Text style={[styles.reason, { color: t.faint }]}>Why it is here: {thread?.split_reason ?? "No explanation saved yet"}</Text>
            </>
          ) : (
            <>
              <Pressable onPress={() => setChosen(null)} hitSlop={8}>
                <Text style={[styles.back, { color: t.accent }]}>‹ Change category</Text>
              </Pressable>
              <Text style={[styles.kicker, { color: t.faint }]}>APPLY {selected?.label.toUpperCase()} TO…</Text>
              <Pressable style={styles.apply} onPress={() => { onApply(chosen, "thread"); close(); }}>
                <Text style={[styles.applyTitle, { color: t.text }]}>This conversation only</Text>
              </Pressable>
              <Pressable disabled={!sender} style={[styles.apply, !sender && styles.disabled]} onPress={() => { onApply(chosen, "sender"); close(); }}>
                <Text style={[styles.applyTitle, { color: t.text }]}>Always from this sender</Text>
                <Text style={[styles.applyNote, { color: t.faint }]}>{sender ?? "Sender address unavailable"}</Text>
              </Pressable>
              <Pressable disabled={!domain} style={[styles.apply, !domain && styles.disabled]} onPress={() => { onApply(chosen, "domain"); close(); }}>
                <Text style={[styles.applyTitle, { color: t.text }]}>Always from this domain</Text>
                <Text style={[styles.applyNote, { color: t.faint }]}>{domain ?? "Domain unavailable"}</Text>
              </Pressable>
              <Text style={[styles.reason, { color: t.faint }]}>Your choice stays on this mailbox and can be changed later.</Text>
            </>
          )}
          <Pressable onPress={close} style={[styles.cancel, { borderTopColor: t.line }]}>
            <Text style={[styles.cancelText, { color: t.sub }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,20,50,0.38)" },
  sheet: { margin: 12, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 4, borderRadius: 22, shadowColor: "#0A2540", shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  kicker: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 8 },
  option: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  optionBody: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 15, fontWeight: "700" },
  optionNote: { fontSize: 12 },
  chevron: { fontSize: 22, fontWeight: "500" },
  reason: { paddingTop: 11, marginTop: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(15,35,58,0.10)", fontSize: 11, lineHeight: 16 },
  back: { fontSize: 13, fontWeight: "700", paddingBottom: 14 },
  apply: { paddingVertical: 12 },
  applyTitle: { fontSize: 15, fontWeight: "600" },
  applyNote: { marginTop: 2, fontSize: 12 },
  disabled: { opacity: 0.45 },
  cancel: { alignItems: "center", paddingVertical: 15, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  cancelText: { fontSize: 16, fontWeight: "700" },
});
