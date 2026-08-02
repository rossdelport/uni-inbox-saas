import { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { User } from "@supabase/supabase-js";
import { Button, ColorDots, Field, Input, PasswordField } from "@/components/Field";
import { ConnectAccountSheet } from "@/components/ConnectAccountSheet";
import {
  useAccounts,
  useBillingState,
  useDeleteOwnAccount,
  useRemoveAccount,
  useUpdateAccount,
} from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import type { EmailAccount } from "@/lib/types";

// Settings, mirroring the web's three panes (Profile, Accounts, Plan) as
// stacked sections rather than a side nav, which suits a phone better.
//
// The Plan section is intentionally read-only. The web version sells here;
// this one cannot, because Apple's Guideline 3.1.1 forbids offering a
// digital subscription outside their IAP. It reports state only.

type Pane = "profile" | "accounts" | "plan";

const PANES: { key: Pane; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "accounts", label: "Accounts" },
  { key: "plan", label: "Plan" },
];

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const [pane, setPane] = useState<Pane>("profile");

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.back, { color: t.accent }]}>‹</Text>
        </Pressable>
        <Text style={[styles.title, { color: t.text }]}>Settings</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.tabs}>
        {PANES.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => setPane(p.key)}
            style={({ pressed }) => [
              styles.tab,
              {
                backgroundColor: pane === p.key ? t.chipActiveBg : t.chipBg,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text
              style={[styles.tabText, { color: pane === p.key ? t.chipActiveText : t.sub }]}
            >
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {pane === "profile" ? <ProfilePane /> : null}
      {pane === "accounts" ? <AccountsPane /> : null}
      {pane === "plan" ? <PlanPane /> : null}
    </SafeAreaView>
  );
}

function ProfilePane() {
  const t = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const deleteAccount = useDeleteOwnAccount();

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setName((data.user?.user_metadata?.full_name as string | undefined) ?? "");
    });
  }, []);

  const saveName = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
    setBusy(false);
    setMsg({ text: error ? error.message : "Name saved.", bad: Boolean(error) });
  };

  const savePassword = async () => {
    if (password.length < 8) return setMsg({ text: "Password must be at least 8 characters.", bad: true });
    if (password !== password2) return setMsg({ text: "Passwords do not match.", bad: true });
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg({ text: error.message, bad: true });
    setPassword("");
    setPassword2("");
    setMsg({ text: "Password updated.", bad: false });
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete your OneInbox account?",
      "This permanently deletes your OneInbox account, connected inbox copies, and settings. It does not delete mail from Gmail, Outlook, or your other providers.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete forever",
          style: "destructive",
          onPress: () =>
            deleteAccount.mutate(undefined, {
              onSuccess: () => void supabase.auth.signOut(),
            }),
        },
      ],
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Your account</Text>
        <Text style={[styles.mail, { color: t.sub }]}>{user?.email ?? "…"}</Text>
        <Field label="Name">
          <Input value={name} onChangeText={setName} placeholder="Your name" />
        </Field>
        <Button label="Save name" onPress={() => void saveName()} busy={busy} />
      </View>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Change password</Text>
        <Field label="New password">
          <PasswordField value={password} onChangeText={setPassword} placeholder="At least 8 characters" />
        </Field>
        <Field label="Confirm new password">
          <PasswordField value={password2} onChangeText={setPassword2} placeholder="Type it again" />
        </Field>
        <Button
          label="Update password"
          onPress={() => void savePassword()}
          disabled={!password}
          busy={busy}
        />
      </View>

      {msg ? (
        <Text style={[styles.note, { color: msg.bad ? t.danger : t.accent }]}>{msg.text}</Text>
      ) : null}

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.cardTitle, { color: t.text }]}>Help and privacy</Text>
        <Button
          label="Privacy policy"
          variant="ghost"
          onPress={() => void Linking.openURL("https://tryoneinbox.co/privacy")}
        />
        <Button
          label="Help and support"
          variant="ghost"
          onPress={() => void Linking.openURL("https://tryoneinbox.co/contacts/")}
        />
      </View>

      <Button label="Sign out" variant="danger" onPress={() => void supabase.auth.signOut()} />
      <Button
        label="Delete account"
        variant="danger"
        busy={deleteAccount.isPending}
        onPress={confirmDelete}
      />
      {deleteAccount.error ? (
        <Text style={[styles.note, { color: t.danger }]}>{deleteAccount.error.message}</Text>
      ) : null}
    </ScrollView>
  );
}

function AccountsPane() {
  const t = useTheme();
  const { data: accounts, isPending } = useAccounts();
  const { data: billing } = useBillingState();
  const [connectOpen, setConnectOpen] = useState(false);

  return (
    <>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.note, { color: t.sub }]}>
          {billing
            ? `${billing.connected_inboxes} of ${billing.max_inboxes} accounts used on the ${billing.plan_label} plan.`
            : "Your connected inboxes."}
        </Text>

        {isPending ? (
          <Text style={[styles.note, { color: t.faint }]}>Loading…</Text>
        ) : (accounts ?? []).length === 0 ? (
          <Text style={[styles.note, { color: t.faint }]}>No inboxes connected yet.</Text>
        ) : (
          (accounts ?? []).map((a) => <AccountRow key={a.id} account={a} />)
        )}

        <Button label="Add account" onPress={() => setConnectOpen(true)} />
      </ScrollView>

      <ConnectAccountSheet visible={connectOpen} onClose={() => setConnectOpen(false)} />
    </>
  );
}

function AccountRow({ account }: { account: EmailAccount }) {
  const t = useTheme();
  const update = useUpdateAccount();
  const remove = useRemoveAccount();
  const [editOpen, setEditOpen] = useState(false);
  const [fixOpen, setFixOpen] = useState(false);
  const [label, setLabel] = useState(account.label);
  const [color, setColor] = useState(account.color);
  const [password, setPassword] = useState("");

  const confirmRemove = () => {
    Alert.alert(
      `Remove ${account.email_address}?`,
      "Its synced mail disappears from OneInbox. The mailbox itself is untouched.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => remove.mutate(account.id) },
      ],
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
      <View style={styles.accHead}>
        <View style={[styles.dot, { backgroundColor: account.color }]} />
        <View style={styles.accText}>
          <Text style={[styles.accLabel, { color: t.text }]} numberOfLines={1}>
            {account.label}
            {account.status === "auth_failed" ? (
              <Text style={{ color: t.danger }}>  Sign in failed</Text>
            ) : null}
            {account.status === "disabled" ? (
              <Text style={{ color: t.faint }}>  Paused</Text>
            ) : null}
          </Text>
          <Text style={[styles.accMail, { color: t.faint }]} numberOfLines={1}>
            {account.email_address}
          </Text>
        </View>
      </View>

      {account.last_error && account.status !== "active" ? (
        <Text style={[styles.note, { color: t.danger }]}>{account.last_error}</Text>
      ) : null}

      <View style={styles.accActs}>
        <MiniBtn
          label="Edit"
          onPress={() => {
            setLabel(account.label);
            setColor(account.color);
            setEditOpen((v) => !v);
          }}
        />
        <MiniBtn label="Password" onPress={() => setFixOpen((v) => !v)} />
        {account.status === "disabled" ? (
          <MiniBtn label="Resume" onPress={() => update.mutate({ id: account.id, status: "active" })} />
        ) : (
          <MiniBtn label="Pause" onPress={() => update.mutate({ id: account.id, status: "disabled" })} />
        )}
        <MiniBtn label="Remove" danger onPress={confirmRemove} />
      </View>

      {editOpen ? (
        <View style={styles.sub}>
          <Field label="Label">
            <Input value={label} onChangeText={setLabel} placeholder="Label in your inbox" />
          </Field>
          <Field label="Colour">
            <ColorDots value={color} onChange={setColor} />
          </Field>
          <Button
            label="Save"
            busy={update.isPending}
            onPress={() => {
              if (!label.trim()) return;
              update.mutate(
                { id: account.id, label: label.trim(), color },
                { onSuccess: () => setEditOpen(false) },
              );
            }}
          />
        </View>
      ) : null}

      {fixOpen ? (
        <View style={styles.sub}>
          <Field label="New password" hint="For Gmail and iCloud this is an app password.">
            <PasswordField value={password} onChangeText={setPassword} placeholder="Paste it here" />
          </Field>
          <Button
            label="Save password"
            disabled={!password}
            busy={update.isPending}
            onPress={() =>
              update.mutate(
                { id: account.id, password },
                {
                  onSuccess: () => {
                    setFixOpen(false);
                    setPassword("");
                  },
                },
              )
            }
          />
        </View>
      ) : null}

      {update.error || remove.error ? (
        <Text style={[styles.note, { color: t.danger }]}>
          {((update.error ?? remove.error) as Error).message}
        </Text>
      ) : null}
    </View>
  );
}

function MiniBtn({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.mini,
        { backgroundColor: t.chipBg, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={[styles.miniText, { color: danger ? t.danger : t.text }]}>{label}</Text>
    </Pressable>
  );
}

function PlanPane() {
  const t = useTheme();
  const { data: billing } = useBillingState();

  const trialDaysLeft = billing?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(billing.trial_ends_at).getTime() - Date.now()) / 86_400_000))
    : null;
  const pct = billing
    ? Math.min(100, Math.round((billing.connected_inboxes / billing.max_inboxes) * 100))
    : 0;

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>
        <Text style={[styles.planTier, { color: t.text }]}>{billing?.plan_label ?? "…"}</Text>
        <Text style={[styles.planPrice, { color: t.sub }]}>
          {billing
            ? billing.plan === "trial"
              ? billing.trial_expired
                ? "Trial ended"
                : `Free trial, ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left`
              : "Active"
            : ""}
        </Text>

        {billing ? (
          <View style={styles.usage}>
            <View style={[styles.bar, { backgroundColor: t.chipBg }]}>
              <View style={[styles.fill, { width: `${pct}%`, backgroundColor: t.accent }]} />
            </View>
            <Text style={[styles.note, { color: t.faint }]}>
              {billing.connected_inboxes} of {billing.max_inboxes} accounts used
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.note, { color: t.sub }]}>Your current account status is shown here.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  backBtn: { width: 44, paddingVertical: 2 },
  back: { fontSize: 30, fontWeight: "600", marginTop: -4 },
  title: { flex: 1, fontSize: 20, fontWeight: "800", textAlign: "center" },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  tab: { flex: 1, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 13, fontWeight: "700" },
  body: { padding: 16, paddingBottom: 48, gap: 14 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  mail: { fontSize: 13 },
  note: { fontSize: 13, lineHeight: 19 },
  accHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  accText: { flex: 1 },
  accLabel: { fontSize: 15, fontWeight: "700" },
  accMail: { fontSize: 12.5 },
  accActs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mini: { height: 32, borderRadius: 8, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  miniText: { fontSize: 12.5, fontWeight: "700" },
  sub: { gap: 12, marginTop: 4 },
  planTier: { fontSize: 22, fontWeight: "800" },
  planPrice: { fontSize: 14 },
  usage: { gap: 6 },
  bar: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
});
