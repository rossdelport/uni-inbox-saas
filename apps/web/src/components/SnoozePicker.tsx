import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useSnooze } from "../lib/queries.js";
import { toast } from "../lib/toast.js";
import { KP, useHotkeys } from "../lib/keyboard.js";

// Snooze menu, portalled to <body>. A portal keeps the menu visible when the
// row or reading pane sits inside an overflow-clipped panel.

function fmt(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
  const [customOpen, setCustomOpen] = useState(false);
  const [customHours, setCustomHours] = useState("");
  const [customMinutes, setCustomMinutes] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  // Overlay priority: Escape closes only the picker, never the thread or
  // modal underneath, and the catch-all stops list shortcuts behind it.
  useHotkeys({ Escape: () => onClose(), "*": () => {} }, { priority: KP.overlay });

  function pick(when: Date, label: string) {
    // The cache update is optimistic, so close the picker on the click rather
    // than making the user watch a network request finish.
    onSnoozed?.();
    onClose();
    snooze.mutate(
      { threadId, until: when.toISOString() },
      {
        onSuccess: () => {
          toast(`Snoozed for ${label} · back at ${fmt(when)}`, "success");
        },
        onError: (e) => toast((e as Error).message, "warn"),
      },
    );
  }

  function pickDuration(hours: number, minutes: number, label: string) {
    const duration = (hours * 60 + minutes) * 60_000;
    if (!Number.isFinite(duration) || duration <= 0) {
      toast("Choose a time longer than zero.", "warn");
      return;
    }
    if (duration > 366 * 24 * 3600_000) {
      toast("Snooze is limited to one year.", "warn");
      return;
    }
    pick(new Date(Date.now() + duration), label);
  }

  function submitCustom(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const hours = Number.parseInt(customHours, 10) || 0;
    const minutes = Number.parseInt(customMinutes, 10) || 0;
    if (hours < 0 || minutes < 0 || minutes > 59) {
      toast("Enter valid hours and minutes.", "warn");
      return;
    }
    const label = [hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean).join(" ");
    pickDuration(hours, minutes, label || "0m");
  }

  // Clamp to the viewport: the anchor can sit near the right or bottom edge.
  const width = 224;
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
  const menuHeight = customOpen ? 194 : 142;
  const top = Math.min(anchor.bottom + 6, Math.max(12, window.innerHeight - menuHeight - 12));

  return createPortal(
    <div
      ref={popRef}
      className="snz-pop"
      style={{ top, left, width }}
      role="menu"
      aria-label="Snooze duration"
    >
      <div className="snz-title">Snooze for</div>
      <button className="snz-item" disabled={snooze.isPending} onClick={() => pickDuration(1, 0, "1 hour")}>
        <span>1 hour</span>
        <i>quick break</i>
      </button>
      <button className="snz-item" disabled={snooze.isPending} onClick={() => pickDuration(6, 0, "6 hours")}>
        <span>6 hours</span>
        <i>later today</i>
      </button>
      <button
        className={`snz-item snz-custom-toggle ${customOpen ? "active" : ""}`}
        disabled={snooze.isPending}
        aria-expanded={customOpen}
        onClick={() => setCustomOpen((open) => !open)}
      >
        <span>Custom</span>
        <i>{customOpen ? "Close" : "Set time"}</i>
      </button>
      {customOpen && (
        <form className="snz-custom" onSubmit={submitCustom}>
          <label>
            <span>Hours</span>
            <input
              type="number"
              min="0"
              max="8784"
              inputMode="numeric"
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            <span>Minutes</span>
            <input
              type="number"
              min="0"
              max="59"
              inputMode="numeric"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
            />
          </label>
          <button className="btn-mini" type="submit" disabled={snooze.isPending}>
            Set
          </button>
        </form>
      )}
    </div>,
    document.body,
  );
}
