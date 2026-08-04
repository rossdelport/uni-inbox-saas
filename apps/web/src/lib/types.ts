// Types shared between @uni/api and @uni/web. The API is the source of truth;
// everything here is the SANITIZED shape the dashboard sees (no credentials).

export type PlanId = "trial" | "monthly" | "yearly" | "lifetime";

export type ProviderPreset = "gmail" | "icloud" | "outlook" | "porkbun" | "custom";

export type AccountStatus = "active" | "auth_failed" | "disabled";
export type SplitClass = "important" | "newsletter" | "other";

/** A connected mailbox, as exposed to the dashboard. Never includes creds. */
export interface EmailAccount {
  id: string;
  label: string;
  email_address: string;
  color: string;
  provider_preset: ProviderPreset;
  auth_method?: "password" | "oauth_google" | "oauth_microsoft";
  status: AccountStatus;
  last_error: string | null;
  created_at: string;
  signature_html?: string | null;
  signature_text?: string | null;
}

/** A recipient suggestion derived from this user's synced mail metadata. */
export interface ContactSuggestion {
  email: string;
  display_name: string | null;
  frequency: number;
  last_seen_at: string;
  account_ids: string[];
}

export interface ThreadSummary {
  id: string;
  account_id: string;
  account_label: string;
  account_color: string;
  account_email: string;
  subject: string | null;
  snippet: string | null;
  from_name: string | null;
  from_address: string | null;
  last_message_at: string;
  message_count: number;
  unread: boolean;
  archived: boolean;
  starred: boolean;
  read_later: boolean;
  split_class: SplitClass;
  split_reason: string | null;
  split_manual: boolean;
  /** Wake time when snoozed, else null. The Snoozed list shows it; the Inbox
   *  simply does not contain snoozed threads. */
  snooze_until: string | null;
  /** True when this thread is part of the sidebar / tab-title count: unread
   *  AND arrived after its account was connected. Sent by the server so the
   *  badge can drop the instant a thread is opened, instead of waiting on a
   *  round trip, and without the client reimplementing that rule. */
  counts_unread: boolean;
}

export interface AttachmentMeta {
  filename: string | null;
  contentType: string | null;
  contentId?: string | null;
  contentDisposition?: string | null;
  related?: boolean;
  size: number;
  partId: string;
}

export interface Message {
  id: string;
  thread_id: string;
  account_id: string;
  from_name: string | null;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  date: string;
  body_text: string | null;
  body_html: string | null;
  snippet: string | null;
  seen: boolean;
  direction: "inbound" | "outbound";
  attachments: AttachmentMeta[];
  /** Client-only state for an optimistic outgoing reply. */
  client_delivery_state?: "sending" | "sent";
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: Message[];
}

export interface InboxPage {
  threads: ThreadSummary[];
  next_cursor: string | null;
}

export interface BillingState {
  /** AI summaries add-on is live on this account. */
  ai_addon: boolean;
  ai_status: string | null;
  ai_price_usd: number;
  plan: PlanId;
  plan_label: string;
  /** Display price for the current state, e.g. "$10/month" or "$97 one-time". */
  price_label: string;
  max_inboxes: number;
  connected_inboxes: number;
  monthly_quantity: number;
  subscription_status: string | null;
  trial_ends_at: string | null;
  trial_expired: boolean;
  pricing: {
    monthly_base_usd: number;
    monthly_included: number;
    monthly_per_extra_usd: number;
    yearly_base_usd: number;
    yearly_per_extra_usd: number;
    yearly_max: number;
    lifetime_usd: number;
    lifetime_max: number;
  };
}

/** Connection settings the user fills in when adding an account. */
export interface AccountInput {
  label: string;
  email_address: string;
  provider_preset: ProviderPreset;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "tls" | "starttls";
  imap_username: string;
  password: string;
  color?: string;
}

export interface TestResult {
  imap_ok: boolean;
  smtp_ok: boolean;
  error: string | null;
}

export interface DiscoverResult {
  detected: string | null;
  mx: string | null;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "tls" | "starttls";
  use_oauth: "google" | "microsoft" | null;
  /** Provider blocks IMAP by design (Proton, Tuta, HEY). Nothing to try. */
  unsupported: boolean;
  note: string | null;
}
