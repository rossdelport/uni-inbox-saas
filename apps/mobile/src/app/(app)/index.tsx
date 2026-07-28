import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActionSheet, type SheetAction } from "@/components/ActionSheet";
import { Chip } from "@/components/Chip";
import { ComposeSheet } from "@/components/ComposeSheet";
import { ConnectAccountSheet } from "@/components/ConnectAccountSheet";
import { ThreadRow } from "@/components/ThreadRow";
import { useSession } from "@/lib/auth";
import {
  useAccounts,
  useDeleteThread,
  useInbox,
  useReadAll,
  useThreadOp,
  useUnreadCounts,
  type InboxView,
} from "@/lib/queries";
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
  const [sheet, setSheet] = useState<{ title?: string | null; actions: SheetAction[] } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  // Pull-to-refresh has its own flag rather than reading isRefetching: that
  // is true for EVERY background refetch (the 15-60s poll, each realtime
  // nudge, every mutation's invalidation), and iOS reveals the spinner
  // programmatically, so the list visibly shoved itself down every time mail
  // arrived or a row was archived.
  const [pulling, setPulling] = useState(false);

  const viewDef = VIEWS.find((v) => v.key === viewKey)!;
  const view: InboxView = { ...viewDef.view, account: accountId };

  const inbox = useInbox(view);
  const { data: accounts } = useAccounts();
  const { data: counts } = useUnreadCounts();
  const threadOp = useThreadOp();
  const deleteThread = useDeleteThread();
  const readAll = useReadAll();

  const { refetch } = inbox;
  const onPull = useCallback(() => {
    setPulling(true);
    void refetch().finally(() => setPulling(false));
  }, [refetch]);

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
    const op = (label: string, name: Parameters<typeof threadOp.mutate>[0]["op"]): SheetAction => ({
      label,
      onPress: () => threadOp.mutate({ threadId: th.id, op: name }),
    });
    setSheet({
      title: th.subject ?? null,
      actions: [
        th.archived ? op("Move to inbox", "unarchive") : op("Archive", "archive"),
        th.starred ? op("Unstar", "unstar") : op("Star", "star"),
        th.read_later ? op("Remove from Later", "unlater") : op("Read later", "later"),
        th.unread ? op("Mark read", "read") : op("Mark unread", "unread"),
        ...(viewKey === "trash" ? [op("Restore", "restore")] : []),
        { label: "Delete", destructive: true, onPress: () => deleteThread.mutate(th.id) },
      ],
    });
  };

  // The + is the app's main navigation, so it holds the things that create
  // something rather than act on what is already there.
  const createMenu = () => {
    setSheet({
      title: null,
      actions: [
        { label: "New message", onPress: () => setComposeOpen(true) },
        { label: "Connect an email account", onPress: () => setConnectOpen(true) },
        { label: "Settings", onPress: () => router.push("/settings") },
      ],
    });
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
            onPress={() => router.push("/settings")}
            hitSlop={6}
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
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} />}
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

      {/* Main navigation. Sits above the list rather than in a bar so it
          never steals height from the mail itself. */}
      <Pressable
        onPress={createMenu}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: t.accent,
            shadowColor: "#000",
            transform: [{ scale: pressed ? 0.94 : 1 }],
          },
        ]}
      >
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>

      <ActionSheet
        visible={sheet !== null}
        title={sheet?.title}
        actions={sheet?.actions ?? []}
        onClose={() => setSheet(null)}
      />
      <ComposeSheet visible={composeOpen} onClose={() => setComposeOpen(false)} />
      <ConnectAccountSheet visible={connectOpen} onClose={() => setConnectOpen(false)} />
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
    // Roomy on purpose. Sitting tight under the status bar with the tab row
    // right beneath it read as cramped, and a mail app is mostly a wall of
    // dense text, so the top of the screen is where the air has to come from.
    paddingTop: 18,
    paddingBottom: 18,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
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
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "700" },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
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
  // Enough tail room that the FAB never covers the last conversation.
  listContent: { paddingBottom: 96 },
  footer: { paddingVertical: 16 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  fabIcon: { color: "#fff", fontSize: 30, fontWeight: "300", marginTop: -3 },
});
