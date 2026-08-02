// Split Inbox classifier. Pure functions over headers already parsed at
// ingest: a handful of Set lookups and one regex. No network, no DB read, no
// model, so it is free to run on every message.

export type SplitClass = "important" | "newsletter" | "other";

// Signal slugs are a DURABLE VOCABULARY: they are written into
// messages.bulk_signals, so renaming one invalidates every stored row. Add
// new slugs freely; never repurpose an old one.

// A machine sent it via an ESP relay. Presence of any of these headers. They
// are useful evidence, but an ESP header on its own is not enough to hide a
// human conversation: newsletter/content evidence wins only when present.
const ESP_HEADERS = [
  "feedback-id",
  "x-ses-outgoing",
  "x-mailgun-sid",
  "x-sg-eid",
  "x-sg-id",
  "x-mandrill-user",
  "x-postmark-account",
  "x-campaign-id",
  "x-campaignid",
  "x-campaign",
  "x-newsletter",
  "x-bulkmail",
  "x-report-abuse",
];

// Robot local-parts. Deliberately narrow: support@, info@, hello@, team@,
// contact@, billing@, sales@, help@ and hi@ are NOT here and must not be
// added. Those are staffed inboxes where a human replies, and burying a real
// reply in a robot pile is the expensive mistake. Do not "improve" this
// regex with them.
const NOREPLY_RE =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|alerts?|automated|auto-?reply|receipts?|orders?|shipping|delivery|tracking|invoices?|transactions?|security|verify|verification|password)([+._-].*)?$/;

// These are intentionally separate from NOREPLY_RE. A sender called
// "updates" or "news" is only a newsletter when the message also looks like
// a digest/broadcast; otherwise a human at updates@ should remain Important.
const NEWSLETTER_SENDER_RE =
  /^(news(?:letter)?|digest|updates?|marketing|campaigns?|offers?|deals?|promotions?)([+._-].*)?$/;

const NEWSLETTER_SUBJECT_RE =
  /\b(newsletter|weekly digest|monthly digest|email digest|unsubscribe|manage (?:your )?preferences|view (?:this )?in (?:your )?browser)\b/i;

const NEWSLETTER_BODY_RE =
  /\b(unsubscribe|manage (?:your )?(?:email )?preferences|email preferences|update subscription|view (?:this )?in (?:your )?browser|no longer wish to receive)\b/i;

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
  subject?: string | null,
  bodyText?: string | null,
  bodyHtml?: string | null,
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

  const subjectText = subject ?? "";
  const body = `${bodyText ?? ""}\n${bodyHtml ?? ""}`;
  if (NEWSLETTER_SUBJECT_RE.test(subjectText)) signals.push("newsletter_subject");
  if (NEWSLETTER_BODY_RE.test(body)) signals.push("newsletter_body");
  if (NEWSLETTER_SENDER_RE.test(localPart)) signals.push("newsletter_sender");

  return signals;
}

/** LIST beats ROBOT on purpose: an unsubscribable blast that also went
 *  through SendGrid is a newsletter you can leave, not a dead-end robot. */
export function classifyFromSignals(signals: readonly string[]): SplitClass {
  const hasListHeader =
    signals.includes("list_unsubscribe") ||
    signals.includes("list_id") ||
    signals.includes("precedence_bulk");
  const hasNewsletterContent =
    signals.includes("newsletter_body") || signals.includes("newsletter_subject");
  const hasNewsletterSender = signals.includes("newsletter_sender");
  const hasBulkRelay = signals.includes("esp_header");

  if (hasListHeader || signals.includes("newsletter_body") || (hasNewsletterSender && (hasNewsletterContent || hasBulkRelay))) {
    return "newsletter";
  }
  if (signals.length > 0) return "other";
  return "important";
}

/** Short explanation shown beside the user's manual classifier controls. */
export function reasonFromSignals(signals: readonly string[]): string {
  if (signals.includes("list_unsubscribe") || signals.includes("list_id") || signals.includes("precedence_bulk")) {
    return "Mailing-list headers";
  }
  if (signals.includes("newsletter_body")) return "Contains newsletter controls";
  if (signals.includes("newsletter_subject")) return "Newsletter-style subject";
  if (signals.includes("newsletter_sender") && signals.includes("esp_header")) {
    return "Newsletter sender and bulk-mail service";
  }
  if (signals.includes("noreply_sender")) return "Automated sender address";
  if (signals.includes("auto_submitted")) return "Automated mail headers";
  if (signals.includes("esp_header")) return "Bulk-mail service header";
  return "No bulk or automated signals";
}

export function classifyWithReason(signals: readonly string[]): {
  splitClass: SplitClass;
  reason: string;
} {
  return { splitClass: classifyFromSignals(signals), reason: reasonFromSignals(signals) };
}
