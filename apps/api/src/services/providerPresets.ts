import type { ProviderPreset } from "@uni/shared";

// Connection presets for the onboarding "connect an inbox" flow. Fields stay
// editable in the UI — presets just prefill the boring parts. Gmail requires
// an app password (2FA on); the dashboard shows inline instructions.
export interface PresetConfig {
  id: ProviderPreset;
  label: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "tls" | "starttls";
}

export const PRESETS: Record<ProviderPreset, PresetConfig> = {
  gmail: {
    id: "gmail",
    label: "Gmail",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    smtp_security: "tls",
  },
  icloud: {
    id: "icloud",
    label: "iCloud Mail",
    imap_host: "imap.mail.me.com",
    imap_port: 993,
    smtp_host: "smtp.mail.me.com",
    smtp_port: 587,
    smtp_security: "starttls",
  },
  outlook: {
    id: "outlook",
    label: "Outlook",
    imap_host: "outlook.office365.com",
    imap_port: 993,
    smtp_host: "smtp.office365.com",
    smtp_port: 587,
    smtp_security: "starttls",
  },
  porkbun: {
    id: "porkbun",
    label: "Porkbun email hosting",
    imap_host: "imap.porkbun.com",
    imap_port: 993,
    smtp_host: "smtp.porkbun.com",
    smtp_port: 587,
    smtp_security: "starttls",
  },
  custom: {
    id: "custom",
    label: "Other (IMAP)",
    imap_host: "",
    imap_port: 993,
    smtp_host: "",
    smtp_port: 465,
    smtp_security: "tls",
  },
};
