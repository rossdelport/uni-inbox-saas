import { supabase } from "./supabase.js";

// Authed calls to the backend API (Railway in production, proxied locally).
const BASE = import.meta.env.VITE_API_URL ?? "";

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

  // Network-level failures (deploy windows, connection blips) get ONE retry —
  // but only for idempotent methods, so a POST can never double-fire.
  const method = (init.method ?? "GET").toUpperCase();
  const idempotent = ["GET", "HEAD", "PUT", "DELETE"].includes(method);
  let res: Response;
  try {
    res = await doFetch();
  } catch (firstErr) {
    if (!idempotent) {
      throw new Error(
        "Can't reach the API server right now. Check your connection and try again.",
      );
    }
    await new Promise((r) => setTimeout(r, 900));
    try {
      res = await doFetch();
    } catch {
      throw new Error(
        "Can't reach the API server right now. Check your connection and try again.",
      );
    }
  }

  // If the SPA rewrite answered instead of the API, VITE_API_URL isn't set.
  if ((res.headers.get("content-type") ?? "").includes("text/html")) {
    throw new Error(
      "Backend API URL is not configured. Set VITE_API_URL to your Railway API URL in Vercel and redeploy.",
    );
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
