import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import type { Message } from "@/lib/types";
import { formatFullDate, formatBytes, senderLabel } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { HtmlBody } from "./HtmlBody";
import { SenderAvatar } from "./SenderAvatar";

type DeliveryState = NonNullable<Message["client_delivery_state"]>;

/** A tiny vertical drum: Sending rolls backwards out of view while Sent
 * rolls in from above. The window stays the same size, so the message card
 * does not jump while the label changes. */
function DeliveryStatus({ state, color }: { state: DeliveryState; color: string }) {
  const progress = useRef(new Animated.Value(state === "sent" ? 1 : 0)).current;
  const previous = useRef(state);

  useEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    Animated.timing(progress, {
      toValue: state === "sent" ? 1 : 0,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, state]);

  const sendingOpacity = progress.interpolate({
    inputRange: [0, 0.58, 1],
    outputRange: [1, 0, 0],
  });
  const sentOpacity = progress.interpolate({
    inputRange: [0, 0.32, 1],
    outputRange: [0, 0, 1],
  });
  const sendingY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 12] });
  const sentY = progress.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });
  const sendingRoll = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-72deg"],
  });
  const sentRoll = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["72deg", "0deg"],
  });

  return (
    <View style={styles.deliveryWindow} accessibilityLabel={state === "sent" ? "Sent" : "Sending"}>
      <Animated.Text
        style={[
          styles.deliveryText,
          {
            color,
            opacity: sendingOpacity,
            transform: [
              { perspective: 180 },
              { translateY: sendingY },
              { rotateX: sendingRoll },
            ],
          },
        ]}
      >
        Sending…
      </Animated.Text>
      <Animated.Text
        style={[
          styles.deliveryText,
          {
            color,
            opacity: sentOpacity,
            transform: [
              { perspective: 180 },
              { translateY: sentY },
              { rotateX: sentRoll },
            ],
          },
        ]}
      >
        Sent
      </Animated.Text>
    </View>
  );
}

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
  const deliveryState =
    message.client_delivery_state ?? (message.id.startsWith("optimistic-") ? "sending" : null);
  const avatarColor = mine ? t.accent : accountColor;

  if (!expanded) {
    return (
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [
          styles.collapsed,
          { backgroundColor: pressed ? "#F1F6FF" : t.card, borderColor: t.line },
        ]}
      >
        <SenderAvatar label={mine ? "You" : sender} color={avatarColor} size={30} solid={mine} />
        <View style={styles.collapsedBody}>
          <Text numberOfLines={1} style={[styles.collapsedSender, { color: t.text }]}>
            {mine ? "You" : sender}
          </Text>
          {deliveryState ? (
            <DeliveryStatus state={deliveryState} color={t.accent} />
          ) : (
            <Text numberOfLines={1} style={[styles.collapsedSnippet, { color: t.sub }]}>
              {message.snippet ?? ""}
            </Text>
          )}
        </View>
        <Text style={[styles.collapsedWhen, { color: t.faint }]}>
          {formatFullDate(message.date)}
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.card,
          borderColor: t.line,
          borderTopColor: accountColor,
        },
      ]}
    >
      <Pressable onPress={onToggle} style={styles.header}>
        <SenderAvatar label={mine ? "You" : sender} color={avatarColor} size={34} solid={mine} />
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={[styles.sender, { color: t.text }]}>
            {mine ? "You" : sender}
          </Text>
          {deliveryState ? (
            <DeliveryStatus state={deliveryState} color={t.accent} />
          ) : (
            <Text numberOfLines={1} style={[styles.meta, { color: t.faint }]}>
              {`to ${message.to_addresses.join(", ") || "(no recipients)"}`}
            </Text>
          )}
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
    padding: 13,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: "#0A2540",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  collapsedBody: { flex: 1 },
  collapsedSender: { fontSize: 14, fontWeight: "600" },
  collapsedSnippet: { fontSize: 12 },
  deliveryWindow: { width: 70, height: 16, overflow: "hidden" },
  deliveryText: {
    position: "absolute",
    left: 0,
    top: 0,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  collapsedWhen: { fontSize: 11 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderTopWidth: 3,
    shadowColor: "#0A2540",
    shadowOpacity: 0.055,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 15,
  },
  headerText: { flex: 1 },
  sender: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12 },
  when: { fontSize: 11 },
  bodyWrap: { paddingHorizontal: 15, paddingBottom: 15 },
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
