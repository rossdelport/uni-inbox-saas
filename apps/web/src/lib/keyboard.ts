import { useEffect } from "react";

// One hotkey layer for the whole app, Superhuman-style single letters.
//
// Ground rules, each load-bearing:
// - NOTHING fires while the user is typing. The guard is isContentEditable
//   plus tag checks, because the reply composer is a contentEditable whose
//   caret can sit inside <b>/<li>/<a> nodes whose tagName is none of INPUT.
//   The one exception is Escape, which blurs the field (Gmail behavior).
// - Modifier combos pass through untouched (Cmd+R, Cmd+F, Ctrl+C stay the
//   browser's). Shift is allowed only for symbols ("?", "#"); Shift+letter
//   dispatches nothing, so a stray Shift+E can never archive.
// - Bindings register with an explicit numeric priority. Child effects run
//   before parent effects, so mount order is exactly backwards as a
//   precedence signal; the registry sorts by priority, then by most recent
//   registration. Dispatch walks that order and stops at the first handler
//   that consumes, which is how Escape closes an overlay without also
//   closing the thread behind it.
// - "*" is a catch-all binding: a modal registers it at KP.overlay so every
//   page-level key goes dead behind the dialog.
// - A global kill switch covers the unpaid paywall: the click gate is
//   capture-phase and mouse-only, and without this an unpaid user could
//   archive, send and delete entirely by keyboard.
// - "g" starts a two-key sequence (g i, g t, ...) with a short timeout,
//   tracked at module level so every hook instance agrees on it. An unbound
//   second key falls back to its plain meaning, so "g" then "j" still moves
//   the cursor.

/** Priorities. Higher wins. */
export const KP = {
  /** App chrome: compose, search, view jumps. */
  page: 10,
  /** The message list: cursor, archive, open. */
  list: 20,
  /** The open conversation pane: reply, back. */
  pane: 30,
  /** Modals and popovers: Escape plus the catch-all. */
  overlay: 40,
} as const;

type Handler = (e: KeyboardEvent) => void | boolean;
export type Bindings = Record<string, Handler>;

let enabled = true;
export function setKeyboardEnabled(on: boolean): void {
  enabled = on;
}

interface Entry {
  bindings: Bindings;
  priority: number;
  seq: number;
}

const entries = new Set<Entry>();
let seq = 0;
let pendingG = 0;
let wired = false;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function dispatch(e: KeyboardEvent) {
  if (!enabled || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  const k = e.key;
  // Only single characters plus Enter and Escape are ours. Tab, arrows,
  // PageDown and friends keep their native behavior everywhere, including
  // under a modal's catch-all.
  if (k.length > 1 && k !== "Enter" && k !== "Escape") return;

  if (isTyping(e.target)) {
    if (k === "Escape") {
      (e.target as HTMLElement).blur?.();
      e.preventDefault();
    }
    return;
  }
  if (e.shiftKey && /^[a-zA-Z]$/.test(k)) return;
  // Enter and Space respect whatever control has focus: after tabbing to a
  // button they must activate that button (even under a modal's catch-all),
  // not open the cursor row.
  if (
    (k === "Enter" || k === " ") &&
    (e.target as HTMLElement | null)?.closest?.("button, a, select, [role='button'], [role='menuitem']")
  ) {
    return;
  }

  const gActive = pendingG > 0 && Date.now() - pendingG < 1500;
  if (!gActive && (k === "g" || k === "G")) {
    pendingG = Date.now();
    return;
  }
  pendingG = 0;

  const plain = k.length === 1 && k !== "?" ? k.toLowerCase() : k;
  const tries = gActive ? [`g ${plain}`, plain] : [plain];

  const order = [...entries].sort((a, b) => b.priority - a.priority || b.seq - a.seq);
  for (const key of tries) {
    for (const en of order) {
      const run = en.bindings[key] ?? en.bindings["*"];
      if (!run) continue;
      if (run(e) === false) continue; // declined: keep walking
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
}

/** Bind keys for the lifetime of the component. Keys are "j", "Enter",
 *  "g i", "?", or "*" for catch-all; a handler returning false declines the
 *  event and lets lower-priority bindings (or the browser) have it. */
export function useHotkeys(
  bindings: Bindings,
  opts: { active?: boolean; priority?: number } = {},
): void {
  const { active = true, priority = KP.page } = opts;
  useEffect(() => {
    if (!active) return;
    const entry: Entry = { bindings, priority, seq: ++seq };
    entries.add(entry);
    if (!wired) {
      window.addEventListener("keydown", dispatch);
      wired = true;
    }
    return () => {
      entries.delete(entry);
    };
  }, [bindings, active, priority]);
}
