import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import { Button, ColorDots, Field, Input, PasswordField } from "./Field";
import { Sheet } from "./Sheet";
import { WEB_URL } from "@/lib/config";
import {
  useBillingState,
  useConnectAccount,
  useDiscover,
  useOauthProviders,
  useOauthStartUrl,
  useTestConnection,
} from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { AccountInput, DiscoverResult, TestResult } from "@/lib/types";

// Connect an account, ported from the web ConnectAccountModal: same four
// providers, same MX autodiscovery, same test-before-save, same OAuth path.
//
// One deliberate difference. On the web, hitting the plan limit turns this
// into the paywall with prices and a checkout button. That cannot ship on
// iOS (Guideline 3.1.1 forbids selling a subscription outside Apple's IAP),
// so the limit state here states the facts and points at the website.

type ProviderKey = "gmail" | "icloud" | "outlook" | "custom";

const PROVIDERS: { key: ProviderKey; label: string; sub: string }[] = [
  { key: "gmail", label: "Gmail", sub: "Google accounts" },
  { key: "icloud", label: "iCloud Mail", sub: "Apple accounts" },
  { key: "outlook", label: "Outlook", sub: "Microsoft accounts" },
  { key: "custom", label: "My own domain", sub: "you@yourbusiness.com" },
];

const HOSTS: Record<
  Exclude<ProviderKey, "custom">,
  Pick<AccountInput, "imap_host" | "imap_port" | "smtp_host" | "smtp_port" | "smtp_security">
> = {
  gmail: { imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 465, smtp_security: "tls" },
  icloud: { imap_host: "imap.mail.me.com", imap_port: 993, smtp_host: "smtp.mail.me.com", smtp_port: 587, smtp_security: "starttls" },
  outlook: { imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587, smtp_security: "starttls" },
};

export function ConnectAccountSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const { data: billing } = useBillingState();
  const atLimit = billing ? billing.connected_inboxes >= billing.max_inboxes : false;

  if (billing && atLimit) {
    return (
      <Sheet
        visible={visible}
        title="Your plan is full"
        subtitle="Manage your plan on the web to make room for another mailbox."
        onClose={onClose}
        heightRatio={0.55}
      >
        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.limitCard, { backgroundColor: t.card, borderColor: t.line }]}>
            <Text style={[styles.limitNum, { color: t.text }]}>
              {billing.connected_inboxes} of {billing.max_inboxes}
            </Text>
            <Text style={[styles.limitTxt, { color: t.sub }]}>
              accounts used on your {billing.plan_label} plan
            </Text>
          </View>
          <Text style={[styles.note, { color: t.sub }]}>
            You can change your plan, or remove an account you no longer need, at tryoneinbox.co.
            Removing one here frees a slot too.
          </Text>
          <Button label="Open tryoneinbox.co" onPress={() => void Linking.openURL(WEB_URL)} />
        </ScrollView>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      title="Connect an account"
      subtitle="Pick where your mail lives. It joins your unified inbox and starts syncing."
      onClose={onClose}
    >
      <ConnectForm onConnected={onClose} />
    </Sheet>
  );
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const t = useTheme();
  const qc = useQueryClient();
  const { data: oauth } = useOauthProviders();
  const oauthStart = useOauthStartUrl();
  const discover = useDiscover();
  const connect = useConnectAccount();
  const testMutation = useTestConnection();

  const [sel, setSel] = useState<ProviderKey>("gmail");
  const [discovery, setDiscovery] = useState<DiscoverResult | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (discoverTimer.current) clearTimeout(discoverTimer.current);
  }, []);

  const [form, setForm] = useState<AccountInput>({
    label: "",
    email_address: "",
    provider_preset: "gmail",
    ...HOSTS.gmail,
    imap_username: "",
    password: "",
  });

  function pick(k: ProviderKey) {
    setSel(k);
    setTest(null);
    setDiscovery(null);
    setError(null);
    setForm((f) => ({
      ...f,
      provider_preset: k,
      ...(k === "custom" ? { imap_host: "", smtp_host: "" } : HOSTS[k]),
    }));
  }

  function set<K extends keyof AccountInput>(key: K, value: AccountInput[K]) {
    setTest(null);
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "email_address" && typeof value === "string") {
        if (!f.imap_username || f.imap_username === f.email_address) next.imap_username = value;
        // Prefill the label with the bare domain name ("perthsolarpanelcleaners"
        // from ross@perthsolarpanelcleaners.com). Stays editable, just a head start.
        if (!f.label || f.label === (f.email_address.split("@")[1] ?? "").split(".")[0]) {
          next.label = (value.split("@")[1] ?? "").split(".")[0] || f.label;
        }
      }
      return next;
    });

    // Own-domain flow: look up where this domain's mail routes and prefill.
    // Only once the address is complete, so we never guess at a half-typed
    // domain.
    if (
      key === "email_address" &&
      sel === "custom" &&
      typeof value === "string" &&
      /@[^@\s]+\.[^@\s]{2,}$/.test(value)
    ) {
      if (discoverTimer.current) clearTimeout(discoverTimer.current);
      discoverTimer.current = setTimeout(() => {
        discover.mutate(value, {
          onSuccess: (d) => {
            setDiscovery(d);
            if (d.imap_host) {
              setForm((f) => ({
                ...f,
                imap_host: d.imap_host,
                imap_port: d.imap_port,
                smtp_host: d.smtp_host,
                smtp_port: d.smtp_port,
                smtp_security: d.smtp_security,
              }));
            }
          },
        });
      }, 500);
    }
  }

  const startOauth = (provider: "google" | "microsoft") => {
    setError(null);
    oauthStart.mutate(provider, {
      onSuccess: async ({ url }) => {
        // The callback lands on the web dashboard and connects the account
        // server-side, so there is nothing to deep-link back into. Open it,
        // let them approve, and refresh the list when they return.
        await WebBrowser.openAuthSessionAsync(url, `${WEB_URL}/app`);
        void qc.invalidateQueries({ queryKey: ["accounts"] });
        void qc.invalidateQueries({ queryKey: ["billing"] });
        void qc.invalidateQueries({ queryKey: ["inbox"] });
        onConnected();
      },
      onError: (e) => setError(e instanceof Error ? e.message : "Could not start sign in."),
    });
  };

  const doConnect = () => {
    connect.mutate(form, {
      onSuccess: () => onConnected(),
      onError: (e) => setError(e instanceof Error ? e.message : "Could not connect."),
    });
  };

  const submit = async () => {
    setError(null);
    let result = test;
    if (!result) {
      result = await testMutation
        .mutateAsync(form)
        .catch((err) => ({ imap_ok: false, smtp_ok: false, error: (err as Error).message }));
      setTest(result);
    }
    if (!result.imap_ok || !result.smtp_ok) return;
    doConnect();
  };

  // `oauth` is undefined until the providers query resolves. Treating that as
  // "OAuth unavailable" would paint the whole password form and then swap it
  // for the Continue with Google button, which reads as the sheet reloading
  // itself. So Gmail and Outlook wait for the real answer.
  const oauthKnown = oauth !== undefined;
  const oauthReady = sel === "gmail" ? oauth?.google === true : sel === "outlook" ? oauth?.microsoft === true : false;
  const awaitingOauth = !oauthKnown && (sel === "gmail" || sel === "outlook");
  const passwordFlow =
    sel === "icloud" ||
    sel === "custom" ||
    (oauthKnown && sel === "gmail" && !oauth.google) ||
    (oauthKnown && sel === "outlook" && !oauth.microsoft);

  const canSubmit = Boolean(form.email_address && form.password && form.label && form.imap_host);

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.provs}>
        {PROVIDERS.map((p) => {
          const active = sel === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => pick(p.key)}
              style={({ pressed }) => [
                styles.prov,
                {
                  backgroundColor: t.card,
                  borderColor: active ? t.accent : t.line,
                  borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[styles.provLabel, { color: t.text }]}>{p.label}</Text>
              <Text style={[styles.provSub, { color: t.faint }]} numberOfLines={1}>
                {p.sub}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {awaitingOauth ? <View style={[styles.skeleton, { backgroundColor: t.line }]} /> : null}

      {(sel === "gmail" || sel === "outlook") && oauthReady ? (
        <View style={styles.gap}>
          <Button
            label={sel === "gmail" ? "Continue with Google" : "Continue with Microsoft"}
            busy={oauthStart.isPending}
            onPress={() => startOauth(sel === "gmail" ? "google" : "microsoft")}
          />
          <Text style={[styles.note, { color: t.faint }]}>
            {sel === "gmail" ? "Google" : "Microsoft"} will ask you to approve OneInbox reading and
            sending your mail. No passwords, revoke anytime from your account.
          </Text>
        </View>
      ) : null}

      {sel === "outlook" && oauthKnown && !oauth.microsoft ? (
        <Text style={[styles.note, { color: t.sub }]}>
          Outlook connections are coming shortly. Microsoft requires app approval that is still in
          progress.
        </Text>
      ) : null}

      {passwordFlow && sel !== "outlook" ? (
        <View style={styles.form}>
          {sel === "gmail" ? (
            <Text style={[styles.note, { color: t.sub }]}>
              Gmail needs an app password: turn on 2 step verification, then create one at
              myaccount.google.com/apppasswords and paste it below.
            </Text>
          ) : null}
          {sel === "icloud" ? (
            <Text style={[styles.note, { color: t.sub }]}>
              iCloud needs an app-specific password: create one at account.apple.com under Sign-In
              and Security, then paste it below.
            </Text>
          ) : null}

          <Field label="Email address">
            <Input
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={
                sel === "gmail" ? "name@gmail.com" : sel === "icloud" ? "name@icloud.com" : "you@yourbusiness.com"
              }
              value={form.email_address}
              onChangeText={(v) => set("email_address", v)}
            />
          </Field>

          {sel === "custom" && form.email_address.includes("@") && !/@[^@\s]+\.[^@\s]{2,}$/.test(form.email_address) ? (
            <Text style={[styles.note, { color: t.sub }]}>
              Finish typing your full address including the ending, like .com or .com.au. We detect
              your email host and fill in the servers automatically.
            </Text>
          ) : null}

          {sel === "custom" && (discover.isPending || discovery) ? (
            <Text style={[styles.note, { color: t.sub }]}>
              {discover.isPending
                ? "Looking up where this domain's mail lives…"
                : discovery?.detected
                  ? `${discovery.detected} detected. Server settings are filled in, just add the mailbox password from your email host.${discovery.note ? ` ${discovery.note}` : ""}`
                  : (discovery?.note ?? "")}
            </Text>
          ) : null}

          <Field label={sel === "gmail" || sel === "icloud" ? "App password" : "Mailbox password"}>
            <PasswordField
              value={form.password}
              onChangeText={(v) => set("password", v)}
              placeholder="Paste it here"
            />
          </Field>

          <Field label="Label" hint="What this mailbox is called in your inbox.">
            <Input
              value={form.label}
              onChangeText={(v) => set("label", v)}
              placeholder="e.g. Solar Cleaning"
            />
          </Field>

          <Field label="Colour">
            <ColorDots value={form.color} onChange={(c) => set("color", c)} />
          </Field>

          <Pressable onPress={() => setAdvanced((v) => !v)} hitSlop={8} style={styles.advToggle}>
            <Text style={[styles.advText, { color: t.accent }]}>
              {advanced ? "Hide server settings" : "Server settings"}
            </Text>
          </Pressable>

          {advanced ? (
            <View style={styles.form}>
              <Field label="Username">
                <Input
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={form.imap_username}
                  onChangeText={(v) => set("imap_username", v)}
                />
              </Field>
              <View style={styles.row}>
                <View style={styles.rowItem}>
                  <Field label="IMAP host">
                    <Input
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={form.imap_host}
                      onChangeText={(v) => set("imap_host", v)}
                    />
                  </Field>
                </View>
                <View style={styles.rowNarrow}>
                  <Field label="Port">
                    <Input
                      keyboardType="number-pad"
                      value={String(form.imap_port)}
                      onChangeText={(v) => set("imap_port", Number(v) || 0)}
                    />
                  </Field>
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.rowItem}>
                  <Field label="SMTP host">
                    <Input
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={form.smtp_host}
                      onChangeText={(v) => set("smtp_host", v)}
                    />
                  </Field>
                </View>
                <View style={styles.rowNarrow}>
                  <Field label="Port">
                    <Input
                      keyboardType="number-pad"
                      value={String(form.smtp_port)}
                      onChangeText={(v) => set("smtp_port", Number(v) || 0)}
                    />
                  </Field>
                </View>
              </View>
              <Field label="SMTP security">
                <View style={styles.segment}>
                  {(["tls", "starttls"] as const).map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => set("smtp_security", s)}
                      style={[
                        styles.segmentItem,
                        {
                          backgroundColor: form.smtp_security === s ? t.accent : t.chipBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          { color: form.smtp_security === s ? "#fff" : t.sub },
                        ]}
                      >
                        {s === "tls" ? "TLS (465)" : "STARTTLS (587)"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Field>
            </View>
          ) : null}

          {test ? (
            <Text
              style={[
                styles.note,
                { color: test.imap_ok && test.smtp_ok ? t.accent : t.danger, fontWeight: "600" },
              ]}
            >
              {test.imap_ok ? "✓ Receiving" : "✕ Receiving"} · {test.smtp_ok ? "✓ Sending" : "✕ Sending"}
              {test.error ? ` · ${test.error}` : ""}
            </Text>
          ) : null}

          {test && test.imap_ok && !test.smtp_ok ? (
            <View style={styles.gap}>
              <Button
                label="Connect anyway, receive only for now"
                variant="ghost"
                busy={connect.isPending}
                onPress={doConnect}
              />
              <Text style={[styles.note, { color: t.faint }]}>
                Mail syncs and reads normally. Sending turns on once the outgoing server is
                reachable.
              </Text>
            </View>
          ) : null}

          {error ? <Text style={[styles.note, { color: t.danger }]}>{error}</Text> : null}

          <Button
            label={test ? "Connect" : "Test and connect"}
            disabled={!canSubmit}
            busy={testMutation.isPending || connect.isPending}
            onPress={() => void submit()}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 40, gap: 14 },
  provs: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  prov: { flexGrow: 1, flexBasis: "46%", borderRadius: 12, padding: 12, gap: 2 },
  provLabel: { fontSize: 14, fontWeight: "700" },
  provSub: { fontSize: 11, fontWeight: "500" },
  skeleton: { height: 46, borderRadius: 12, opacity: 0.35 },
  form: { gap: 14 },
  gap: { gap: 8 },
  note: { fontSize: 12.5, lineHeight: 18 },
  row: { flexDirection: "row", gap: 10 },
  rowItem: { flex: 1 },
  rowNarrow: { width: 96 },
  advToggle: { paddingVertical: 4 },
  advText: { fontSize: 13, fontWeight: "700" },
  segment: { flexDirection: "row", gap: 8 },
  segmentItem: { flex: 1, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segmentText: { fontSize: 12.5, fontWeight: "700" },
  limitCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 18, alignItems: "center", gap: 4 },
  limitNum: { fontSize: 26, fontWeight: "800" },
  limitTxt: { fontSize: 13 },
});
