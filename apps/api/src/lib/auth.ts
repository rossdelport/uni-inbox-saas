import type { NextFunction, Request, Response } from "express";
import { supabase } from "./supabase.js";

// Verifies the Supabase Auth JWT the dashboard sends and attaches the user id
// to res.locals so routes can enforce per-user ownership. Public signup is
// open, so every request must be scoped to its owner.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "invalid or expired token" });
    return;
  }
  res.locals.userId = data.user.id;
  next();
}

/** The current request's authenticated user id (set by requireAuth). */
export function userId(res: Response): string {
  return res.locals.userId as string;
}
