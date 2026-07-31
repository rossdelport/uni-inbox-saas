// Split Inbox classifier. Pure functions over headers already parsed at
// ingest: a handful of Set lookups and one regex. No network, no DB read, no
// model, so it is free to run on every message.

export type SplitClass = "important" | "newsletter" | "other";

// Signal slugs are a DURABLE VOCABULARY: they are written into
// messages.bulk_signals, so renaming one invalidates every stored row. Add
// new slugs freely; never repurpose an old one.

// A machine sent it via an ESP relay. Presence of any of these headers.
const ESP_HEADERS = [
  "feedback-id",
  "x-ses-outgoing",
  "x-mailgun-sid",
  "x-sg-eid",
  "x-mandrill-user",
  "x-postmark-account",
  "x-campaign-id",
  "x-campaignid",
  "x-report-abuse",
];

// Robot local-parts. Deliberately narrow: support@, info@, hello@, team@,
// contact@, billing@, sales@, help@ and hi@ are NOT here and must not be
// added. Those are staffed inboxes where a human replies, and burying a real
// reply in a robot pile is the expensive mistake. Do not "improve" this
// regex with them.
const NOREPLY_RE =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|alerts?|automated|auto-?reply)([+._-].*)?$/;

/**
 * Evidence found in one message's headers and sender.
 *
 * `headerKeys` are the lowercased header names present; `headerValue` reads a
 * header where the VALUE matters (mailparser shapes some values into objects,
 * so callers stringify). LIST signals mean "subscribed, can leave"; the rest
 * mean "a robot, nothing to leave".
 */
export function bulkSignals(
  headerKeys: Set<string>,
  headerValue: (k: string) => string | null,
  fromAddress: string,
): string[] {
  const signals: string[] = [];

  if (headerKeys.has("list-unsubscribe") || headerKeys.has("list-unsubscribe-post")) {
    signals.push("list_unsubscribe");
  }
  if (headerKeys.has("list-id") || headerKeys.has("list-post")) {
    signals.push("list_id");
  }
  const precedence = (headerValue("precedence") ?? "").toLowerCase();
  if (["bulk", "list", "junk"].includes(precedence)) {
    signals.push("precedence_bulk");
  }

  const autoSubmitted = (headerValue("auto-submitted") ?? "").toLowerCase();
  if (
    (headerKeys.has("auto-submitted") && autoSubmitted !== "no") ||
    headerKeys.has("x-auto-response-suppress")
  ) {
    signals.push("auto_submitted");
  }
  if (ESP_HEADERS.some((h) => headerKeys.has(h))) {
    signals.push("esp_header");
  }
  const localPart = fromAddress.split("@")[0]?.toLowerCase() ?? "";
  if (NOREPLY_RE.test(localPart)) {
    signals.push("noreply_sender");
  }

  return signals;
}

/** LIST beats ROBOT on purpose: an unsubscribable blast that also went
 *  through SendGrid is a newsletter you can leave, not a dead-end robot. */
export function classifyFromSignals(signals: readonly string[]): SplitClass {
  if (signals.includes("list_unsubscribe") || signals.includes("list_id") || signals.includes("precedence_bulk")) {
    return "newsletter";
  }
  if (signals.length > 0) return "other";
  return "important";
}
