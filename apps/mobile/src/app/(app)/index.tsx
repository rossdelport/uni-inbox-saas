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
import { useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActionSheet, type SheetAction } from "@/components/ActionSheet";
import { BrandMark } from "@/components/BrandMark";
import { Chip } from "@/components/Chip";
import { ComposeSheet } from "@/components/ComposeSheet";
import { SnoozeSheet } from "@/components/SnoozeSheet";
import { SplitSheet } from "@/components/SplitSheet";
import { ThreadRow } from "@/components/ThreadRow";
import { useSession } from "@/lib/auth";
import {
  useAccounts,
  useDeleteThread,
  useInbox,
  useReadAll,
  useSplitThread,
  useSyncAccounts,
  useThreadOp,
  useUnreadCounts,
  type InboxView,
} from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { SplitClass, ThreadSummary } from "@/lib/types";

// The unified inbox. View tabs mirror the web sidebar (Inbox, Starred,
// Snoozed, Sent, Trash); the account row appears once there is more
// than one mailbox. Tapping a row marks it read on the way in, exactly like
// the web list, so the badge moves on the tap.

type ViewKey = "inbox" | "starred" | "later" | "sent" | "trash";

const VIEWS: { key: ViewKey; label: string; view: InboxView; empty: string }[] = [
  { key: "inbox", label: "All inboxes", view: {}, empty: "Nothing here. Enjoy the quiet." },
  { key: "starred", label: "Starred", view: { starred: true }, empty: "No starred conversations." },
  { key: "later", label: "Snoozed", view: { later: true }, empty: "Nothing snoozed. Emails you snooze will stay here until they wake." },
  { key: "sent", label: "Sent", view: { sent: true }, empty: "No sent mail yet." },
  { key: "trash", label: "Trash", view: { deleted: true }, empty: "Trash is empty." },
];

export default function InboxScreen() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const [viewKey, setViewKey] = useState<ViewKey>("inbox");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [splitClass, setSplitClass] = useState<SplitClass | null>(null);
  const [sheet, setSheet] = useState<{ title?: string | null; actions: SheetAction[] } | null>(null);
  const [splitTarget, setSplitTarget] = useState<ThreadSummary | null>(null);
  const [snoozeTarget, setSnoozeTarget] = useState<ThreadSummary | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  // Pull-to-refresh has its own flag rather than reading isRefetching: that
  // is true for EVERY background refetch (the 15-60s poll, each realtime
  // nudge, every mutation's invalidation), and iOS reveals the spinner
  // programmatically, so the list visibly shoved itself down every time mail
  // arrived or a row was archived.
  const [pulling, setPulling] = useState(false);

  const viewDef = VIEWS.find((v) => v.key === viewKey)!;
  const view: InboxView = {
    ...viewDef.view,
    account: accountId,
    split: viewKey === "inbox" ? splitClass : null,
  };

  const inbox = useInbox(view);
  const { data: accounts } = useAccounts();
  const { data: counts } = useUnreadCounts();
  const threadOp = useThreadOp();
  const deleteThread = useDeleteThread();
  const splitThread = useSplitThread();
  const readAll = useReadAll();
  const syncAccounts = useSyncAccounts();

  const { refetch } = inbox;
  const activeAccountIds = useMemo(
    () => (accounts ?? []).filter((account) => account.status === "active").map((account) => account.id),
    [accounts],
  );
  const onPull = useCallback(() => {
    setPulling(true);
    if (activeAccountIds.length === 0) {
      void refetch().finally(() => setPulling(false));
      return;
    }
    syncAccounts.mutate(activeAccountIds, {
      onSettled: () => void refetch().finally(() => setPulling(false)),
    });
  }, [activeAccountIds, refetch, syncAccounts]);

  const selectAllInboxes = useCallback(() => {
    // The first view chip is also the unified mailbox shortcut: reset the
    // account filter so the All account chip below paints active immediately.
    setViewKey("inbox");
    setAccountId(null);
    setSplitClass(null);
    setPulling(true);
    if (activeAccountIds.length === 0) {
      void qc.invalidateQueries({ queryKey: ["inbox"] }).finally(() => setPulling(false));
      return;
    }
    syncAccounts.mutate(activeAccountIds, {
      onSettled: () => {
        // State updates above make the all-mail query active before this
        // callback runs (the sync nudge intentionally lasts 800ms).
        void qc
          .refetchQueries({ queryKey: ["inbox", "all"], type: "active" })
          .finally(() => setPulling(false));
      },
    });
  }, [activeAccountIds, qc, syncAccounts]);

  const selectAccount = useCallback(
    (nextAccountId: string) => {
      // Tapping the already-selected account is a quick way out of a
      // Starred/Later/etc. view. Keep that mailbox selected, clear the view
      // filter, and let the account-scoped inbox query show every message.
      if (accountId === nextAccountId) {
        if (viewKey !== "inbox" || splitClass !== null) {
          setViewKey("inbox");
          setSplitClass(null);
        }
        return;
      }
      setAccountId(nextAccountId);
    },
    [accountId, splitClass, viewKey],
  );

  const threads = useMemo(
    () => inbox.data?.pages.flatMap((p) => p.threads) ?? [],
    [inbox.data],
  );
  const unreadHere = threads.some((th) => th.unread);
  const hasMailboxWarning = (accounts ?? []).some(
    (account) => account.status === "auth_failed" || account.status === "disabled",
  );
  const healthColor = inbox.isError ? "#D93025" : hasMailboxWarning ? "#F5A623" : "#00B050";

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
        th.starred ? op("Unstar", "unstar") : op("Star", "star"),
        {
          label: th.snooze_until || th.read_later ? "Change snooze / unsnooze" : "Snooze",
          onPress: () => setSnoozeTarget(th),
        },
        { label: "Change category", onPress: () => setSplitTarget(th) },
        th.unread ? op("Mark read", "read") : op("Mark unread", "unread"),
        ...(viewKey === "trash" ? [op("Restore", "restore")] : []),
        { label: "Delete", destructive: true, onPress: () => deleteThread.mutate(th.id) },
      ],
    });
  };

  const total = counts?.total ?? 0;
  const initial = (session?.user.email?.[0] ?? "?").toUpperCase();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <BrandMark size={31} showWordmark={false} />
          <View style={styles.heading}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: t.text }]}>{viewDef.label}</Text>
              {total > 0 ? (
                <View style={[styles.badge, { backgroundColor: t.accentSoft }]}>
                  <Text style={[styles.badgeText, { color: t.accent }]}>{total > 99 ? "99+" : total}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={onPull}
            disabled={pulling}
            style={({ pressed }) => [
              styles.sync,
              { backgroundColor: "#FFFFFF", borderColor: t.line, opacity: pressed || pulling ? 0.6 : 1 },
            ]}
          >
            <View style={styles.syncContent}>
              {pulling ? <ActivityIndicator size="small" color={t.sub} /> : <Text style={[styles.syncIcon, { color: t.sub }]}>↻</Text>}
              <Text style={[styles.syncText, { color: t.sub }]}>{pulling ? "Syncing" : "Sync"}</Text>
            </View>
          </Pressable>
          <View
            accessibilityLabel={inbox.isError ? "Mailbox error" : hasMailboxWarning ? "Mailbox warning" : "Mailboxes healthy"}
            style={[styles.healthDot, { backgroundColor: healthColor }]}
          />
          {unreadHere && viewKey !== "sent" && viewKey !== "trash" ? (
            <Pressable
              onPress={() =>
                readAll.mutate({
                  account: accountId,
                  starred: viewKey === "starred",
                  later: viewKey === "later",
                  split: splitClass,
                })
              }
              disabled={readAll.isPending}
              style={({ pressed }) => [
                styles.readAll,
                { backgroundColor: "#FFFFFF", borderColor: t.line, opacity: pressed || readAll.isPending ? 0.6 : 1 },
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
              { backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={styles.avatarText}>{initial}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.filterWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chips}
        >
          {VIEWS.map((v) => (
            <Chip
              key={v.key}
              label={v.label}
              active={v.key === viewKey}
              onPress={() => {
                if (v.key === "inbox") selectAllInboxes();
                else {
                  setViewKey(v.key);
                  setSplitClass(null);
                }
              }}
            />
          ))}
        </ScrollView>
        {(accounts?.length ?? 0) > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chips}
          >
            <Chip label="All" active={accountId === null} onPress={() => setAccountId(null)} />
            {accounts!.map((a) => (
              <Chip
                key={a.id}
                label={a.label}
                active={accountId === a.id}
                onPress={() => selectAccount(a.id)}
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
              Open Settings, choose Accounts, then tap Add account.
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
          style={styles.list}
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
        onPress={() => setComposeOpen(true)}
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
      <SnoozeSheet
        visible={snoozeTarget !== null}
        thread={snoozeTarget}
        onClose={() => setSnoozeTarget(null)}
        onUnsnooze={() => {
          if (snoozeTarget) threadOp.mutate({ threadId: snoozeTarget.id, op: "unlater" });
        }}
      />
      <SplitSheet
        visible={splitTarget !== null}
        thread={splitTarget}
        onClose={() => setSplitTarget(null)}
        onApply={(next, remember) => {
          if (splitTarget) {
            splitThread.mutate({ threadId: splitTarget.id, splitClass: next, remember });
          }
        }}
      />
      <ComposeSheet visible={composeOpen} onClose={() => setComposeOpen(false)} />
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
    paddingTop: 12,
    paddingBottom: 6,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11, flexShrink: 1 },
  heading: { flexShrink: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 25, fontWeight: "800", letterSpacing: -0.6 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 11, fontWeight: "800" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 7 },
  sync: {
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  syncContent: { flexDirection: "row", alignItems: "center", gap: 5 },
  syncIcon: { fontSize: 16, lineHeight: 16, fontWeight: "700" },
  syncText: { fontSize: 11, fontWeight: "700" },
  readAll: {
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  readAllText: { fontSize: 11, fontWeight: "700" },
  healthDot: { width: 9, height: 9, borderRadius: 4.5, marginHorizontal: 1 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0C7DFF",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  avatarText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  filterWrap: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingTop: 8,
    paddingBottom: 2,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    shadowColor: "#0A2540",
    shadowOpacity: 0.035,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  // Keep every horizontal filter row inset from the rounded white surface.
  // The first row used to begin at the edge on iOS because ScrollView's
  // content inset was being swallowed by the parent shadow container.
  // Keep the inset on the scroll content, not the ScrollView itself. Native
  // scrolling can consume ScrollView padding and let the chips touch the
  // rounded container edge after the first swipe.
  chipScroll: {},
  chips: { gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
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
  list: { backgroundColor: "transparent" },
  listContent: { paddingTop: 4, paddingBottom: 104 },
  footer: { paddingVertical: 16 },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 26,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 7,
  },
  fabIcon: { color: "#fff", fontSize: 30, fontWeight: "300", marginTop: -3 },
});
