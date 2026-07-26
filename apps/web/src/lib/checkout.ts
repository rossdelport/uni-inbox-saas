import { api } from "./api.js";

// Card-first signup. The visitor pays at Stripe before an account exists, so
// the Checkout session id travels back on the success URL and has to be bound
// to whatever account they then create. That binding is the "claim".
//
// It cannot always happen right after the signup call: when email confirmation
// is on, supabase.auth.signUp returns no session, and the account is only
// usable minutes later when they follow the link. So the id is parked in
// localStorage and claimed on the first authenticated load, whenever that is.

const PENDING_KEY = "oi-checkout-session";

/** Where someone without a paid session gets sent. Plans are picked first now. */
export const PRICING_URL = "/pricing";

export function checkoutSessionFromUrl(): string | null {
  const id = new URLSearchParams(window.location.search).get("session_id");
  return id && id.startsWith("cs_") ? id : null;
}

export function rememberCheckout(sessionId: string): void {
  try {
    localStorage.setItem(PENDING_KEY, sessionId);
  } catch {
    /* private mode: the in-page claim still runs, only the retry is lost */
  }
}

export function pendingCheckout(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingCheckout(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export interface CheckoutSummary {
  email: string | null;
  tier: string;
  trial_ends_at: string | null;
  complete: boolean;
}

/** Non-secret detail about a paid session, for prefilling the signup form. */
export async function fetchCheckoutSummary(sessionId: string): Promise<CheckoutSummary> {
  return api<CheckoutSummary>(`/api/checkout/session/${encodeURIComponent(sessionId)}`);
}

/** Bind a paid checkout to the signed-in account. Safe to call repeatedly. */
export async function claimPendingCheckout(): Promise<void> {
  const sessionId = pendingCheckout();
  if (!sessionId) return;
  try {
    await api("/api/billing/claim", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId }),
    });
    clearPendingCheckout();
  } catch (err) {
    // Keep it stored so the next load retries: a claim can legitimately fail
    // once if Stripe has not finished settling the session. Only drop it when
    // the server says it belongs to someone else, which retrying cannot fix.
    const msg = err instanceof Error ? err.message : "";
    if (/already linked to another account/i.test(msg)) clearPendingCheckout();
  }
}
