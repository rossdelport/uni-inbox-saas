// Mirror of apps/web/src/lib/types.ts, the SANITIZED shapes the API exposes
// to clients (no credentials). The API is the source of truth; keep the two
// copies in sync when the API changes.

export type PlanId = "trial" | "monthly" | "yearly" | "lifetime";

export type ProviderPreset = "gmail" | "icloud" | "outlook" | "porkbun" | "custom";

export type AccountStatus = "active" | "auth_failed" | "disabled";
export type SplitClass = "important" | "newsletter" | "other";

/** A connected mailbox, as exposed to clients. Never includes creds. */
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
  snooze_until: string | null;
  split_class: SplitClass;
  split_reason: string | null;
  split_manual: boolean;
  /** True when this thread is part of the badge count: unread AND arrived
   *  after its account was connected. Sent by the server so the badge can
   *  drop the instant a thread is opened, without the client reimplementing
   *  that rule. */
  counts_unread: boolean;
}

export interface AttachmentMeta {
  filename: string | null;
  contentType: string | null;
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
  /** Mobile-only optimistic delivery state. The API does not persist this;
   * it lets an outgoing reply stay on screen while its server copy settles. */
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
  note: string | null;
}

export interface BillingState {
  plan: PlanId;
  plan_label: string;
  /** Display price for the current state, e.g. "$7/month" or "$50 one-time". */
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
