import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Message } from "@/lib/types";
import { formatFullDate, formatBytes, senderLabel } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { HtmlBody } from "./HtmlBody";
import { SenderAvatar } from "./SenderAvatar";

// One message inside a thread. Older messages start collapsed to a single
// tappable line; the newest is expanded, Gmail-style. Attachments are listed
// but not downloadable yet: fetching them needs an authed stream and a share
// sheet, which is queued behind the first on-device build.
export function MessageCard({
  message,
  accountColor,
  expanded,
  onToggle,
}: {
  message: Message;
  accountColor: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  const sender = senderLabel(message.from_name, message.from_address);
  const mine = message.direction === "outbound";

  if (!expanded) {
    return (
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.collapsed,
          { backgroundColor: pressed ? t.chipBg : t.card, borderColor: t.line },
        ]}
      >
        <SenderAvatar label={mine ? "You" : sender} color={accountColor} size={30} />
        <View style={styles.collapsedBody}>
          <Text numberOfLines={1} style={[styles.collapsedSender, { color: t.text }]}>
            {mine ? "You" : sender}
          </Text>
          <Text numberOfLines={1} style={[styles.collapsedSnippet, { color: t.sub }]}>
            {message.snippet ?? ""}
          </Text>
        </View>
        <Text style={[styles.collapsedWhen, { color: t.faint }]}>
          {formatFullDate(message.date)}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <Pressable onPress={onToggle} style={styles.header}>
        <SenderAvatar label={mine ? "You" : sender} color={accountColor} size={34} />
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={[styles.sender, { color: t.text }]}>
            {mine ? "You" : sender}
          </Text>
          <Text numberOfLines={1} style={[styles.meta, { color: t.faint }]}>
            to {message.to_addresses.join(", ") || "(no recipients)"}
          </Text>
        </View>
        <Text style={[styles.when, { color: t.faint }]}>{formatFullDate(message.date)}</Text>
      </Pressable>

      <View style={styles.bodyWrap}>
        {message.body_html ? (
          <HtmlBody bodyHtml={message.body_html} />
        ) : (
          <Text selectable style={[styles.textBody, { color: t.text }]}>
            {message.body_text ?? "(empty message)"}
          </Text>
        )}
      </View>

      {message.attachments.length > 0 ? (
        <View style={styles.attachments}>
          {message.attachments.map((a) => (
            <View key={a.partId} style={[styles.attachment, { backgroundColor: t.chipBg }]}>
              <Text numberOfLines={1} style={[styles.attachmentName, { color: t.sub }]}>
                {a.filename ?? "attachment"}
              </Text>
              <Text style={[styles.attachmentSize, { color: t.faint }]}>{formatBytes(a.size)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  collapsedBody: { flex: 1 },
  collapsedSender: { fontSize: 14, fontWeight: "600" },
  collapsedSnippet: { fontSize: 12 },
  collapsedWhen: { fontSize: 11 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  headerText: { flex: 1 },
  sender: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12 },
  when: { fontSize: 11 },
  bodyWrap: { paddingHorizontal: 12, paddingBottom: 12 },
  textBody: { fontSize: 15, lineHeight: 22 },
  attachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  attachment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 220,
  },
  attachmentName: { fontSize: 12, fontWeight: "500", flexShrink: 1 },
  attachmentSize: { fontSize: 11 },
});
