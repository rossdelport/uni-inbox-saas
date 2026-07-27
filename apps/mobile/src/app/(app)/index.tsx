import { useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chip } from "@/components/Chip";
import { ThreadRow } from "@/components/ThreadRow";
import { useSession } from "@/lib/auth";
import { WEB_URL } from "@/lib/config";
import {
  useAccounts,
  useDeleteThread,
  useInbox,
  useReadAll,
  useThreadOp,
  useUnreadCounts,
  type InboxView,
  type ThreadOpName,
} from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import type { ThreadSummary } from "@/lib/types";

// The unified inbox. View tabs mirror the web sidebar (Inbox, Starred,
// Later, Archived, Sent, Trash); the account row appears once there is more
// than one mailbox. Tapping a row marks it read on the way in, exactly like
// the web list, so the badge moves on the tap.

type ViewKey = "inbox" | "starred" | "later" | "archived" | "sent" | "trash";

const VIEWS: { key: ViewKey; label: string; view: InboxView; empty: string }[] = [
  { key: "inbox", label: "Inbox", view: {}, empty: "Nothing here. Enjoy the quiet." },
  { key: "starred", label: "Starred", view: { starred: true }, empty: "No starred conversations." },
  { key: "later", label: "Later", view: { later: true }, empty: "Nothing saved for later." },
  { key: "archived", label: "Archived", view: { archived: true }, empty: "Nothing archived yet." },
  { key: "sent", label: "Sent", view: { sent: true }, empty: "No sent mail yet." },
  { key: "trash", label: "Trash", view: { deleted: true }, empty: "Trash is empty." },
];

export default function InboxScreen() {
  const t = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const [viewKey, setViewKey] = useState<ViewKey>("inbox");
  const [accountId, setAccountId] = useState<string | null>(null);

  const viewDef = VIEWS.find((v) => v.key === viewKey)!;
  const view: InboxView = { ...viewDef.view, account: accountId };

  const inbox = useInbox(view);
  const { data: accounts } = useAccounts();
  const { data: counts } = useUnreadCounts();
  const threadOp = useThreadOp();
  const deleteThread = useDeleteThread();
  const readAll = useReadAll();

  const threads = useMemo(
    () => inbox.data?.pages.flatMap((p) => p.threads) ?? [],
    [inbox.data],
  );
  const unreadHere = threads.some((th) => th.unread);

  const openThread = (th: ThreadSummary) => {
    if (th.unread) threadOp.mutate({ threadId: th.id, op: "read" });
    router.push(`/thread/${th.id}`);
  };

  const rowActions = (th: ThreadSummary) => {
    const actions: { label: string; op?: ThreadOpName; del?: boolean }[] = [
      th.archived ? { label: "Move to inbox", op: "unarchive" } : { label: "Archive", op: "archive" },
      th.starred ? { label: "Unstar", op: "unstar" } : { label: "Star", op: "star" },
      th.read_later ? { label: "Remove from Later", op: "unlater" } : { label: "Read later", op: "later" },
      th.unread ? { label: "Mark read", op: "read" } : { label: "Mark unread", op: "unread" },
      ...(viewKey === "trash" ? [{ label: "Restore", op: "restore" as ThreadOpName }] : []),
      { label: "Delete", del: true },
    ];
    const run = (a: { op?: ThreadOpName; del?: boolean }) => {
      if (a.del) deleteThread.mutate(th.id);
      else if (a.op) threadOp.mutate({ threadId: th.id, op: a.op });
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: th.subject ?? undefined,
          options: [...actions.map((a) => a.label), "Cancel"],
          destructiveButtonIndex: actions.findIndex((a) => a.del),
          cancelButtonIndex: actions.length,
        },
        (i) => {
          if (i < actions.length) run(actions[i]!);
        },
      );
    } else {
      Alert.alert(th.subject ?? "Conversation", undefined, [
        ...actions.map((a) => ({ text: a.label, onPress: () => run(a) })),
        { text: "Cancel", style: "cancel" as const },
      ]);
    }
  };

  const accountMenu = () => {
    const options = ["Open web dashboard", "Sign out", "Cancel"];
    const handle = (i: number) => {
      if (i === 0) void Linking.openURL(`${WEB_URL}/app`);
      if (i === 1) void supabase.auth.signOut();
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: session?.user.email ?? "", options, cancelButtonIndex: 2 },
        handle,
      );
    } else {
      Alert.alert(session?.user.email ?? "", undefined, [
        { text: options[0]!, onPress: () => handle(0) },
        { text: options[1]!, onPress: () => handle(1) },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const total = counts?.total ?? 0;
  const initial = (session?.user.email?.[0] ?? "?").toUpperCase();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: t.text }]}>{viewDef.label}</Text>
          {total > 0 ? (
            <View style={[styles.badge, { backgroundColor: t.accent }]}>
              <Text style={styles.badgeText}>{total > 99 ? "99+" : total}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          {unreadHere && viewKey !== "sent" && viewKey !== "trash" ? (
            <Pressable
              onPress={() =>
                readAll.mutate({
                  account: accountId,
                  archived: viewKey === "archived",
                  starred: viewKey === "starred",
                  later: viewKey === "later",
                })
              }
              disabled={readAll.isPending}
              style={({ pressed }) => [
                styles.readAll,
                { backgroundColor: t.chipBg, opacity: pressed || readAll.isPending ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.readAllText, { color: t.sub }]}>Read all</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={accountMenu}
            style={({ pressed }) => [
              styles.avatar,
              { backgroundColor: t.chipActiveBg, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.avatarText, { color: t.chipActiveText }]}>{initial}</Text>
          </Pressable>
        </View>
      </View>

      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {VIEWS.map((v) => (
            <Chip
              key={v.key}
              label={v.label}
              active={v.key === viewKey}
              onPress={() => setViewKey(v.key)}
            />
          ))}
        </ScrollView>
        {(accounts?.length ?? 0) > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            <Chip label="All" active={accountId === null} onPress={() => setAccountId(null)} />
            {accounts!.map((a) => (
              <Chip
                key={a.id}
                label={a.label}
                active={accountId === a.id}
                onPress={() => setAccountId(a.id)}
                dotColor={a.color}
                count={counts?.by_account[a.id] ?? 0}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>

      {inbox.isError ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: t.text }]}>Couldn't load your inbox</Text>
          <Text style={[styles.emptyBody, { color: t.sub }]}>
            {inbox.error instanceof Error ? inbox.error.message : "Something went wrong."}
          </Text>
          <Pressable
            onPress={() => void inbox.refetch()}
            style={({ pressed }) => [
              styles.retry,
              { backgroundColor: t.accent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : inbox.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : threads.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: t.text }]}>
            {accounts && accounts.length === 0 ? "No mailboxes connected" : viewDef.empty}
          </Text>
          {accounts && accounts.length === 0 ? (
            <Text style={[styles.emptyBody, { color: t.sub }]}>
              Connect your mailboxes on the web at tryoneinbox.co, they'll show up here.
            </Text>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(th) => th.id}
          renderItem={({ item }) => (
            <ThreadRow
              thread={item}
              showAccount={accountId === null && (accounts?.length ?? 0) > 1}
              onPress={() => openThread(item)}
              onLongPress={() => rowActions(item)}
            />
          )}
          style={{ backgroundColor: t.card }}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={inbox.isRefetching && !inbox.isFetchingNextPage}
              onRefresh={() => void inbox.refetch()}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (inbox.hasNextPage && !inbox.isFetchingNextPage) void inbox.fetchNextPage();
          }}
          ListFooterComponent={
            inbox.isFetchingNextPage ? (
              <View style={styles.footer}>
                <ActivityIndicator />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  readAll: {
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  readAllText: { fontSize: 12, fontWeight: "600" },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "700" },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  emptyBody: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  retry: {
    marginTop: 8,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  listContent: { paddingBottom: 24 },
  footer: { paddingVertical: 16 },
});
