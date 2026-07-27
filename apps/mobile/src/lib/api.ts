import { API_URL } from "./config";
import { supabase } from "./supabase";

// Authed calls to the backend API. Same contract as the web dashboard's
// api() helper; the only mobile difference is that the base URL must be
// absolute (there is no page origin to be relative to).

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

  // Network-level failures (deploy windows, cellular blips) get ONE retry —
  // but only for idempotent methods, so a POST can never double-fire.
  const method = (init.method ?? "GET").toUpperCase();
  const idempotent = ["GET", "HEAD", "PUT", "DELETE"].includes(method);
  let res: Response;
  try {
    res = await doFetch();
  } catch (firstErr) {
    if (!idempotent) {
      throw new Error("Can't reach OneInbox right now. Check your connection and try again.");
    }
    await new Promise((r) => setTimeout(r, 900));
    try {
      res = await doFetch();
    } catch {
      throw new Error("Can't reach OneInbox right now. Check your connection and try again.");
    }
  }

  // The marketing site answers /api-less paths with HTML; if that comes back
  // the base URL is pointed somewhere wrong (usually a stale EXPO_PUBLIC_API_URL).
  if ((res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error("The API URL looks wrong. Check EXPO_PUBLIC_API_URL.");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
