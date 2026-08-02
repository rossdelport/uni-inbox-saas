import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

export type SplitClass = "important" | "newsletter" | "other";
export type SplitRuleKind = "sender" | "domain";

export interface SplitRuleMatch {
  splitClass: SplitClass;
  reason: string;
  kind: SplitRuleKind;
  value: string;
}

interface RuleRow {
  match_kind: SplitRuleKind;
  match_value: string;
  split_class: SplitClass;
}

interface CachedRules {
  expiresAt: number;
  rows: RuleRow[];
}

const cache = new Map<string, CachedRules>();
const CACHE_MS = 60_000;

export function normalizeSender(value: string): string {
  return value.trim().toLowerCase();
}

export function senderDomain(value: string): string | null {
  const at = normalizeSender(value).lastIndexOf("@");
  const domain = at < 0 ? "" : value.slice(at + 1).trim().toLowerCase();
  return domain && domain.includes(".") ? domain : null;
}

function cacheKey(ownerId: string, accountId: string): string {
  return `${ownerId}:${accountId}`;
}

async function loadRules(ownerId: string, accountId: string): Promise<RuleRow[]> {
  const key = cacheKey(ownerId, accountId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.rows;

  const { data, error } = await supabase
    .from("split_rules")
    .select("match_kind, match_value, split_class")
    .eq("owner_id", ownerId)
    .eq("account_id", accountId)
    .limit(200);
  if (error) {
    logger.warn({ err: error, ownerId, accountId }, "split rules lookup failed");
    cache.set(key, { expiresAt: Date.now() + 10_000, rows: [] });
    return [];
  }
  const rows = (data ?? []) as RuleRow[];
  cache.set(key, { expiresAt: Date.now() + CACHE_MS, rows });
  return rows;
}

export async function findSplitRule(
  ownerId: string,
  accountId: string,
  fromAddress: string,
): Promise<SplitRuleMatch | null> {
  const sender = normalizeSender(fromAddress);
  const domain = senderDomain(sender);
  if (!sender) return null;
  const rows = await loadRules(ownerId, accountId);
  // Exact sender corrections are more specific than a domain correction.
  const match = rows.find((row) => row.match_kind === "sender" && row.match_value === sender)
    ?? (domain ? rows.find((row) => row.match_kind === "domain" && row.match_value === domain) : undefined);
  if (!match) return null;
  return {
    splitClass: match.split_class,
    kind: match.match_kind,
    value: match.match_value,
    reason: match.match_kind === "sender"
      ? "Your rule for this sender"
      : "Your rule for this domain",
  };
}

export async function rememberSplitRule(
  ownerId: string,
  accountId: string,
  kind: SplitRuleKind,
  value: string,
  splitClass: SplitClass,
): Promise<void> {
  const normalized = kind === "sender" ? normalizeSender(value) : senderDomain(value) ?? normalizeSender(value);
  const { data: existing, error: lookupError } = await supabase
    .from("split_rules")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("account_id", accountId)
    .eq("match_kind", kind)
    .eq("match_value", normalized)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing?.id) {
    const { error } = await supabase
      .from("split_rules")
      .update({ split_class: splitClass, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("split_rules").insert({
      owner_id: ownerId,
      account_id: accountId,
      match_kind: kind,
      match_value: normalized,
      split_class: splitClass,
    });
    if (error) throw error;
  }
  cache.delete(cacheKey(ownerId, accountId));
}
