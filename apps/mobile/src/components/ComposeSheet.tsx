import { useRef, useState } from "react";
import {
  InputAccessoryView,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Button, Field, Input } from "./Field";
import { Sheet } from "./Sheet";
import { useAccounts, useCompose } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

// New message. The one place where the sending account is an explicit
// choice: replies always go out from whichever address received the thread,
// decided server-side, but a fresh message has no thread to infer from.

export function ComposeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const router = useRouter();
  const { data: accounts } = useAccounts();
  const compose = useCompose();

  const active = (accounts ?? []).filter((a) => a.status === "active");
  const [accountId, setAccountId] = useState<string>("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const subjectRef = useRef<TextInput>(null);
  const bodyRef = useRef<TextInput>(null);
  const keyboardAccessoryId = "oneinbox-compose-keyboard";

  const fromId = accountId || active[0]?.id || "";
  const recipients = to
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const canSend = recipients.length > 0 && Boolean(fromId) && body.trim().length > 0;

  const reset = () => {
    setTo("");
    setSubject("");
    setBody("");
    setError(null);
    setAccountId("");
  };

  const send = () => {
    if (!canSend) return;
    setError(null);
    compose.mutate(
      { account_id: fromId, to: recipients, subject, body_text: body },
      {
        onSuccess: ({ thread_id }) => {
          reset();
          onClose();
          // Older API deployments may still return a queued response without
          // a thread id. Never navigate to /thread/undefined; the message
          // will appear in Sent after that server finishes its queue pass.
          if (!thread_id) {
            Alert.alert("Message queued", "It will appear in Sent once the mail server finishes.");
            return;
          }
          // Let the drawer finish its slide-down before opening the sent
          // thread, so sending feels like a deliberate close rather than a
          // route that abruptly replaces the composer.
          setTimeout(() => router.push(`/thread/${thread_id}`), 220);
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Could not send."),
      },
    );
  };

  if (active.length === 0) {
    return (
      <Sheet
        visible={visible}
        title="New message"
        subtitle="Connect a mailbox first, then you can send from it."
        onClose={onClose}
        heightRatio={0.4}
      >
        <View style={styles.empty}>
          <Text style={[styles.note, { color: t.sub }]}>
            You have no active mailboxes yet. Add one with the + button, then come back.
          </Text>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      title="New message"
      subtitle="Pick which address it sends from."
      onClose={onClose}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
      >
        <Field label="From">
          <View style={styles.froms}>
            {active.map((a) => {
              const on = fromId === a.id;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountId(a.id)}
                  style={({ pressed }) => [
                    styles.from,
                    {
                      backgroundColor: t.card,
                      borderColor: on ? a.color : t.line,
                      borderWidth: on ? 2 : StyleSheet.hairlineWidth,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: a.color }]} />
                  <View style={styles.fromText}>
                    <Text style={[styles.fromLabel, { color: t.text }]} numberOfLines={1}>
                      {a.label}
                    </Text>
                    <Text style={[styles.fromMail, { color: t.faint }]} numberOfLines={1}>
                      {a.email_address}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="To">
          <Input
            inputAccessoryViewID={keyboardAccessoryId}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => subjectRef.current?.focus()}
            placeholder="name@example.com, other@example.com"
            value={to}
            onChangeText={setTo}
          />
        </Field>

        <Field label="Subject">
          <Input
            ref={subjectRef}
            inputAccessoryViewID={keyboardAccessoryId}
            returnKeyType="next"
            onSubmitEditing={() => bodyRef.current?.focus()}
            value={subject}
            onChangeText={setSubject}
            placeholder="What it's about"
          />
        </Field>

        <Field label="Message">
          <Input
            ref={bodyRef}
            inputAccessoryViewID={keyboardAccessoryId}
            multiline
            value={body}
            onChangeText={setBody}
            placeholder="Write your message"
            style={styles.bodyInput}
          />
        </Field>

        {error ? <Text style={[styles.note, { color: t.danger }]}>{error}</Text> : null}

        <Button
          label="Send"
          disabled={!canSend}
          busy={compose.isPending}
          onPress={send}
        />
      </ScrollView>
      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={keyboardAccessoryId}>
          <View style={[styles.keyboardAccessory, { borderTopColor: t.line, backgroundColor: t.card }]}>
            <Pressable
              onPress={() => Keyboard.dismiss()}
              hitSlop={8}
              style={({ pressed }) => [styles.keyboardDone, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.keyboardDoneText, { color: t.accent }]}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: 18, paddingBottom: 44, gap: 16 },
  empty: { padding: 22 },
  note: { fontSize: 13, lineHeight: 19 },
  froms: { gap: 8 },
  from: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 14, shadowColor: "#0A2540", shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  fromText: { flex: 1 },
  fromLabel: { fontSize: 14, fontWeight: "700" },
  fromMail: { fontSize: 12 },
  bodyInput: { minHeight: 170, textAlignVertical: "top" },
  keyboardAccessory: {
    height: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  keyboardDone: { minWidth: 54, alignItems: "center", justifyContent: "center" },
  keyboardDoneText: { fontSize: 15, fontWeight: "700" },
});
