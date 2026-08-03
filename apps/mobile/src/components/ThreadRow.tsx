import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThreadSummary } from "@/lib/types";
import { formatWhen, senderLabel } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { SenderAvatar } from "./SenderAvatar";

// One conversation in the list. Unread rows lead with an accent dot and a
// bold sender, mirroring the web list. The account chip only appears in the
// All view, where rows from different mailboxes interleave.
export const ThreadRow = memo(function ThreadRow({
  thread,
  showAccount,
  onPress,
  onLongPress,
}: {
  thread: ThreadSummary;
  showAccount: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const t = useTheme();
  const sender = senderLabel(thread.from_name, thread.from_address);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? "#F1F6FF" : t.card,
          borderColor: t.line,
          borderLeftColor: thread.account_color,
          // The account colour is the only colour cue on a message row. Keep
          // it visible for read and unread mail and give it a little more
          // weight than the previous 3px unread-only stripe.
          borderLeftWidth: thread.unread ? 4 : 2,
        },
      ]}
    >
      <View style={styles.leading}>
        <View
          style={[styles.unreadDot, { backgroundColor: thread.unread ? t.accent : "transparent" }]}
        />
        <SenderAvatar label={sender} color={thread.account_color} />
      </View>
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text
            numberOfLines={1}
            style={[
              styles.sender,
              { color: t.text, fontWeight: thread.unread ? "700" : "500" },
            ]}
          >
            {sender}
          </Text>
          {thread.starred ? <Text style={[styles.star, { color: t.star }]}>★</Text> : null}
          <Text style={[styles.when, { color: thread.unread ? t.accent : t.faint }]}>
            {formatWhen(thread.last_message_at)}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          style={[styles.subject, { color: t.text, fontWeight: thread.unread ? "600" : "400" }]}
        >
          {thread.subject || "(no subject)"}
        </Text>
        <View style={styles.bottomLine}>
          <Text numberOfLines={1} style={[styles.snippet, { color: t.sub }]}>
            {thread.snippet ?? ""}
          </Text>
          {thread.message_count > 1 ? (
            <Text style={[styles.count, { color: t.faint }]}>{thread.message_count}</Text>
          ) : null}
        </View>
        {showAccount ? (
          <View style={styles.accountLine}>
            <View style={[styles.accountDot, { backgroundColor: thread.account_color }]} />
            <Text numberOfLines={1} style={[styles.accountLabel, { color: t.faint }]}>
              {thread.account_label}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 14,
    paddingRight: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#0A2540",
    shadowOpacity: 0.045,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  leading: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 10,
  },
  unreadDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 5 },
  body: { flex: 1, gap: 3 },
  topLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  sender: { flex: 1, fontSize: 15 },
  star: { fontSize: 12 },
  when: { fontSize: 12, fontWeight: "500" },
  subject: { fontSize: 14 },
  bottomLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  snippet: { flex: 1, fontSize: 13, lineHeight: 17 },
  count: { fontSize: 11, fontWeight: "600" },
  accountLine: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  accountDot: { width: 6, height: 6, borderRadius: 3 },
  accountLabel: { fontSize: 11, fontWeight: "500" },
});
