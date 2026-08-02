import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSnooze } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { ThreadSummary } from "@/lib/types";

export function SnoozeSheet({
  visible,
  thread,
  onClose,
  onUnsnooze,
}: {
  visible: boolean;
  thread: ThreadSummary | null;
  onClose: () => void;
  onUnsnooze: () => void;
}) {
  const t = useTheme();
  const snooze = useSnooze();
  const [customOpen, setCustomOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");

  function close() {
    setCustomOpen(false);
    setHours("");
    setMinutes("");
    onClose();
  }

  function pick(durationMinutes: number) {
    if (!thread || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return;
    snooze.mutate(
      { threadId: thread.id, until: new Date(Date.now() + durationMinutes * 60_000).toISOString() },
      { onSuccess: close },
    );
  }

  function submitCustom() {
    const h = Number.parseInt(hours, 10) || 0;
    const m = Number.parseInt(minutes, 10) || 0;
    if (h < 0 || m < 0 || m > 59) return;
    pick(h * 60 + m);
  }

  const alreadySnoozed = Boolean(thread?.snooze_until || thread?.read_later);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={[styles.sheet, { backgroundColor: t.card }]} onPress={() => {}}>
            <Text style={[styles.kicker, { color: t.faint }]}>SNOOZE FOR</Text>
            <Pressable disabled={snooze.isPending} onPress={() => pick(60)} style={styles.item}>
              <Text style={[styles.itemTitle, { color: t.text }]}>1 hour</Text>
              <Text style={[styles.itemNote, { color: t.faint }]}>Quick break</Text>
            </Pressable>
            <Pressable disabled={snooze.isPending} onPress={() => pick(360)} style={styles.item}>
              <Text style={[styles.itemTitle, { color: t.text }]}>6 hours</Text>
              <Text style={[styles.itemNote, { color: t.faint }]}>Later today</Text>
            </Pressable>
            <Pressable disabled={snooze.isPending} onPress={() => setCustomOpen((open) => !open)} style={styles.item}>
              <Text style={[styles.itemTitle, { color: t.text }]}>Custom</Text>
              <Text style={[styles.itemNote, { color: t.faint }]}>{customOpen ? "Close" : "Set hours and minutes"}</Text>
            </Pressable>
            {customOpen ? (
              <View style={[styles.custom, { borderTopColor: t.line }]}>
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: t.faint }]}>Hours</Text>
                  <TextInput keyboardType="number-pad" value={hours} onChangeText={setHours} style={[styles.input, { color: t.text, borderColor: t.line }]} />
                </View>
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: t.faint }]}>Minutes</Text>
                  <TextInput keyboardType="number-pad" value={minutes} onChangeText={setMinutes} style={[styles.input, { color: t.text, borderColor: t.line }]} />
                </View>
                <Pressable onPress={submitCustom} style={[styles.set, { backgroundColor: t.accent }]}>
                  <Text style={styles.setText}>Set</Text>
                </Pressable>
              </View>
            ) : null}
            {alreadySnoozed ? (
              <Pressable onPress={() => { onUnsnooze(); close(); }} style={[styles.unsnooze, { borderTopColor: t.line }]}>
                <Text style={[styles.unsnoozeText, { color: t.accent }]}>Unsnooze now</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={close} style={[styles.cancel, { borderTopColor: t.line }]}>
              <Text style={[styles.cancelText, { color: t.sub }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,20,50,0.38)" },
  sheet: { margin: 12, paddingTop: 18, paddingHorizontal: 16, paddingBottom: 4, borderRadius: 22, shadowColor: "#0A2540", shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  kicker: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: 4 },
  item: { paddingVertical: 12 },
  itemTitle: { fontSize: 15, fontWeight: "700" },
  itemNote: { marginTop: 2, fontSize: 12 },
  custom: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  field: { flex: 1, gap: 4 },
  fieldLabel: { fontSize: 10, fontWeight: "700" },
  input: { height: 38, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 15 },
  set: { height: 38, paddingHorizontal: 13, borderRadius: 10, justifyContent: "center" },
  setText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  unsnooze: { marginTop: 12, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth },
  unsnoozeText: { fontSize: 15, fontWeight: "700" },
  cancel: { alignItems: "center", paddingVertical: 15, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  cancelText: { fontSize: 16, fontWeight: "700" },
});
