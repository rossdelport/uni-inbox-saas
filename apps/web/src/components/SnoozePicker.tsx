import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSnooze } from "../lib/queries.js";
import { toast } from "../lib/toast.js";
import { KP, useHotkeys } from "../lib/keyboard.js";

// Snooze menu, portalled to <body>. A portal because both intended anchors
// live inside overflow-clipped containers (.dash-side hides x-overflow, list
// rows clip), the same trap SecurityBadge already solved the same way.

const DAY = 24 * 3600 * 1000;

function at(base: Date, hour: number): Date {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Preset wake times, computed from "now" at open. Anything already past is
 *  dropped rather than shown disabled: a dead option is noise. */
function presets(): Array<{ label: string; when: Date }> {
  const now = new Date();
  const list: Array<{ label: string; when: Date }> = [];

  const laterToday = new Date(now.getTime() + 3 * 3600 * 1000);
  if (laterToday.getDate() === now.getDate()) {
    list.push({ label: "Later today", when: laterToday });
  }
  const evening = at(now, 18);
  if (evening.getTime() > now.getTime() + 30 * 60_000) {
    list.push({ label: "This evening", when: evening });
  }
  list.push({ label: "Tomorrow morning", when: at(new Date(now.getTime() + DAY), 8) });

  // Next Saturday, skipping "today is Saturday" (that is what Later today is
  // for) by always moving at least one day forward.
  const sat = new Date(now.getTime() + DAY);
  while (sat.getDay() !== 6) sat.setTime(sat.getTime() + DAY);
  list.push({ label: "This weekend", when: at(sat, 8) });

  const mon = new Date(now.getTime() + DAY);
  while (mon.getDay() !== 1) mon.setTime(mon.getTime() + DAY);
  list.push({ label: "Next week", when: at(mon, 8) });

  return list;
}

function fmt(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function SnoozePicker({
  threadId,
  anchor,
  onClose,
  onSnoozed,
}: {
  threadId: string;
  anchor: DOMRect;
  onClose: () => void;
  onSnoozed?: () => void;
}) {
  const snooze = useSnooze();
  const [custom, setCustom] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);
  // Overlay priority: Escape closes only the picker, never the thread or
  // modal underneath, and the catch-all stops "h"/"e" acting behind it.
  useHotkeys({ Escape: () => onClose(), "*": () => {} }, { priority: KP.overlay });

  function pick(when: Date) {
    snooze.mutate(
      { threadId, until: when.toISOString() },
      {
        onSuccess: () => {
          toast(`Snoozed until ${fmt(when)}`, "success");
          onSnoozed?.();
          onClose();
        },
        onError: (e) => toast((e as Error).message, "warn"),
      },
    );
  }

  // Clamp to the viewport: the anchor chip can sit near the right edge.
  const width = 232;
  const left = Math.min(anchor.left, window.innerWidth - width - 12);
  const top = anchor.bottom + 6;

  return createPortal(
    <div ref={popRef} className="snz-pop" style={{ top, left, width }} role="menu">
      {presets().map((p) => (
        <button key={p.label} className="snz-item" disabled={snooze.isPending} onClick={() => pick(p.when)}>
          <span>{p.label}</span>
          <i>{fmt(p.when)}</i>
        </button>
      ))}
      <div className="snz-custom">
        <input
          type="datetime-local"
          value={custom}
          min={new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 16)}
          onChange={(e) => setCustom(e.target.value)}
        />
        <button
          className="btn-mini"
          disabled={!custom || snooze.isPending}
          onClick={() => {
            const when = new Date(custom);
            if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) {
              toast("Pick a time in the future.", "warn");
              return;
            }
            pick(when);
          }}
        >
          Set
        </button>
      </div>
    </div>,
    document.body,
  );
}
