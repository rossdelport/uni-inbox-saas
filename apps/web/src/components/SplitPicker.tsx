import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSplitThread } from "../lib/queries.js";
import { toast } from "../lib/toast.js";
import type { SplitClass } from "../lib/types.js";

const OPTIONS: Array<{ value: SplitClass; label: string; note: string; color: string }> = [
  { value: "important", label: "Important", note: "Keep it in your main inbox", color: "#1769d5" },
  { value: "newsletter", label: "Newsletter", note: "Mailing lists and updates", color: "#a855f7" },
  { value: "other", label: "Other", note: "Receipts, alerts, and automated mail", color: "#e88a00" },
];

function domainOf(address: string | null): string | null {
  const value = (address ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  return at > 0 && value.slice(at + 1).includes(".") ? value.slice(at + 1) : null;
}

export function SplitPicker({
  threadId,
  sender,
  reason,
  anchor,
  onClose,
}: {
  threadId: string;
  sender: string | null;
  reason: string | null;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const split = useSplitThread();
  const [chosen, setChosen] = useState<SplitClass | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const domain = domainOf(sender);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  function apply(remember: "thread" | "sender" | "domain") {
    if (!chosen) return;
    split.mutate(
      { threadId, splitClass: chosen, remember },
      {
        onSuccess: () => {
          const label = OPTIONS.find((item) => item.value === chosen)?.label ?? chosen;
          toast(remember === "thread" ? `Moved to ${label}` : `Saved a rule for ${label.toLowerCase()} mail`, "success");
          onClose();
        },
        onError: (error) => toast((error as Error).message, "warn"),
      },
    );
  }

  const width = 276;
  const height = chosen ? 246 : 264;
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12));
  const top = Math.min(anchor.bottom + 6, Math.max(12, window.innerHeight - height - 12));
  const selected = OPTIONS.find((item) => item.value === chosen);

  return createPortal(
    <div ref={popRef} className="split-pop" style={{ top, left, width }} role="menu" aria-label="Move conversation">
      {!chosen ? (
        <>
          <div className="split-title">Move this conversation</div>
          {OPTIONS.map((option) => (
            <button key={option.value} className="split-choice" onClick={() => setChosen(option.value)}>
              <i style={{ background: option.color }} />
              <span><b>{option.label}</b><small>{option.note}</small></span>
              <em>›</em>
            </button>
          ))}
          <div className="split-why">Why it is here: {reason ?? "No explanation saved yet"}</div>
        </>
      ) : (
        <>
          <button className="split-back" onClick={() => setChosen(null)}>‹ Change category</button>
          <div className="split-title">Apply <b style={{ color: selected?.color }}>{selected?.label}</b> to…</div>
          <button className="split-apply" disabled={split.isPending} onClick={() => apply("thread")}>This conversation only</button>
          <button className="split-apply" disabled={split.isPending || !sender} onClick={() => apply("sender")}>
            Always from this sender
            <small>{sender ?? "Sender address unavailable"}</small>
          </button>
          <button className="split-apply" disabled={split.isPending || !domain} onClick={() => apply("domain")}>
            Always from this domain
            <small>{domain ?? "Domain unavailable"}</small>
          </button>
          <div className="split-why">Your choice stays on this mailbox and can be changed later.</div>
        </>
      )}
    </div>,
    document.body,
  );
}
