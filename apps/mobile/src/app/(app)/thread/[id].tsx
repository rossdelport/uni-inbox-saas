import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { MessageCard } from "@/components/MessageCard";
import { ReplyBar } from "@/components/ReplyBar";
import { useDeleteThread, useThread, useThreadOp } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

// One conversation. Older messages collapse to a line, the newest stays
// open, Gmail-style. A ScrollView rather than a FlatList on purpose: the
// HTML bodies are WebViews that re-measure from scratch every time
// virtualization remounts them, which makes a FlatList visibly jumpy.
// Threads are short (rollups cap the common case), so this is fine.

export default function ThreadScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = typeof id === "string" ? id : null;

  const { data, isPending, isError, error, refetch } = useThread(threadId);
  const threadOp = useThreadOp();
  const deleteThread = useDeleteThread();
  const scrollRef = useRef<ScrollView>(null);

  // Which messages are open. Starts as "just the newest" once data arrives;
  // taps toggle from there.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const messages = useMemo(() => data?.messages ?? [], [data]);
  useEffect(() => {
    if (messages.length === 0) return;
    setExpanded((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { [messages[messages.length - 1]!.id]: true };
    });
  }, [messages]);

  // Opening from the list already marked it read, but a thread can also be
  // reached with the list stale (realtime nudge mid-navigation); this is the
  // safety net so an open conversation can never stay "unread".
  const markedRef = useRef(false);
  useEffect(() => {
    if (data?.thread.unread && !markedRef.current) {
      markedRef.current = true;
      threadOp.mutate({ threadId: data.thread.id, op: "read" });
    }
  }, [data, threadOp]);

  const thread = data?.thread;

  const moreMenu = () => {
    if (!thread) return;
    const actions: { label: string; run: () => void; destructive?: boolean }[] = [
      {
        label: thread.archived ? "Move to inbox" : "Archive",
        run: () => {
          threadOp.mutate({ threadId: thread.id, op: thread.archived ? "unarchive" : "archive" });
          router.back();
        },
      },
      {
        label: thread.read_later ? "Remove from Later" : "Read later",
        run: () => threadOp.mutate({ threadId: thread.id, op: thread.read_later ? "unlater" : "later" }),
      },
      {
        label: "Mark unread",
        run: () => {
          threadOp.mutate({ threadId: thread.id, op: "unread" });
          router.back();
        },
      },
      {
        label: "Delete",
        destructive: true,
        run: () => {
          deleteThread.mutate(thread.id);
          router.back();
        },
      },
    ];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...actions.map((a) => a.label), "Cancel"],
          destructiveButtonIndex: actions.findIndex((a) => a.destructive),
          cancelButtonIndex: actions.length,
        },
        (i) => {
          if (i < actions.length) actions[i]!.run();
        },
      );
    } else {
      Alert.alert("Conversation", undefined, [
        ...actions.map((a) => ({ text: a.label, onPress: a.run })),
        { text: "Cancel", style: "cancel" as const },
      ]);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top", "bottom"]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.back, { color: t.accent }]}>‹</Text>
        </Pressable>
        <Text numberOfLines={1} style={[styles.subject, { color: t.text }]}>
          {thread?.subject || "Conversation"}
        </Text>
        {thread ? (
          <View style={styles.headerActions}>
            <Pressable
              onPress={() =>
                threadOp.mutate({ threadId: thread.id, op: thread.starred ? "unstar" : "star" })
              }
              hitSlop={8}
              style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.star, { color: thread.starred ? t.star : t.faint }]}>
                {thread.starred ? "★" : "☆"}
              </Text>
            </Pressable>
            <Pressable
              onPress={moreMenu}
              hitSlop={8}
              style={({ pressed }) => [styles.headerBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.more, { color: t.sub }]}>⋯</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.headerActions} />
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {isError ? (
          <View style={styles.center}>
            <Text style={[styles.errorTitle, { color: t.text }]}>Couldn't load this conversation</Text>
            <Text style={[styles.errorBody, { color: t.sub }]}>
              {error instanceof Error ? error.message : "Something went wrong."}
            </Text>
            <Pressable
              onPress={() => void refetch()}
              style={({ pressed }) => [
                styles.retry,
                { backgroundColor: t.accent, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : isPending || !thread ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={styles.messages}
              onContentSizeChange={() => {
                // New content (a sent reply landing) belongs on screen.
                scrollRef.current?.scrollToEnd({ animated: false });
              }}
            >
              {messages.map((m) => (
                <MessageCard
                  key={m.id}
                  message={m}
                  accountColor={thread.account_color}
                  expanded={Boolean(expanded[m.id])}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                />
              ))}
            </ScrollView>
            <ReplyBar
              threadId={thread.id}
              accountEmail={thread.account_email}
              accountColor={thread.account_color}
              onSent={() => scrollRef.current?.scrollToEnd({ animated: true })}
            />
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  back: { fontSize: 30, fontWeight: "600", marginTop: -4 },
  subject: { flex: 1, fontSize: 16, fontWeight: "700" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 60 },
  star: { fontSize: 20 },
  more: { fontSize: 22, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  errorTitle: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  errorBody: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  retry: {
    marginTop: 8,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  messages: { padding: 12, gap: 10 },
});
