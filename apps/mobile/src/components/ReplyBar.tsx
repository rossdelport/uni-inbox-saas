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
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 6,
  },
  error: { fontSize: 12, fontWeight: "500" },
  hint: { fontSize: 11 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 130,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 15,
  },
  send: {
    height: 38,
    minWidth: 64,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  sendText: { fontSize: 14, fontWeight: "700" },
});
