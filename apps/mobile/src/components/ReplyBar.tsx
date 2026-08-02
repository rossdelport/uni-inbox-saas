import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useReply } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

// Pinned reply composer. The server resolves which account sends (always the
// address that received the thread) and handles quoting; the client only
// supplies the text, which is why this can stay so small.
export function ReplyBar({
  threadId,
  accountEmail,
  accountColor,
  onSent,
}: {
  threadId: string;
  accountEmail: string;
  accountColor: string;
  onSent: () => void;
}) {
  const t = useTheme();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reply = useReply();

  const send = () => {
    const body = text.trim();
    if (!body || reply.isPending) return;
    setError(null);
    reply.mutate(
      { threadId, body_text: body },
      {
        onSuccess: () => {
          setText("");
          onSent();
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Send failed. Try again."),
      },
    );
  };

  return (
    <View style={[styles.wrap, { backgroundColor: t.card, borderTopColor: t.line }]}>
      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
      <Text style={[styles.hint, { color: t.faint }]}>
        Replying as <Text style={{ color: accountColor, fontWeight: "600" }}>{accountEmail}</Text>
      </Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { color: t.text, backgroundColor: t.chipBg }]}
          placeholder="Write a reply"
          placeholderTextColor={t.faint}
          multiline
          value={text}
          onChangeText={setText}
          editable={!reply.isPending}
        />
        <Pressable
          onPress={send}
          disabled={!text.trim() || reply.isPending}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: text.trim() ? t.accent : t.chipBg,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          {reply.isPending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.sendText, { color: text.trim() ? "#fff" : t.faint }]}>Send</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 7,
    shadowColor: "#0A2540",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 3,
  },
  error: { fontSize: 12, fontWeight: "500" },
  hint: { fontSize: 11 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 130,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DFE7F1",
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
  },
  send: {
    height: 42,
    minWidth: 70,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  sendText: { fontSize: 14, fontWeight: "700" },
});
