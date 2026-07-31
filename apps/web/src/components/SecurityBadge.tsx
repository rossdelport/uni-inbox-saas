import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KP, useHotkeys } from "../lib/keyboard.js";

// Trust marker at the foot of the sidebar. Ads brought in people asking "is it
// encrypted?", so the answer is worth stating where they can find it.
//
// Every claim below is load-bearing and must stay true to the code:
//   - AES-256-GCM         lib/crypto.ts (encryptCredentials)
//   - TLS 993/465         services/imapClient.ts, services/providerPresets.ts
//   - per-owner isolation the RLS policies on threads/messages
//   - deleted on disconnect  messages.account_id ... on delete cascade
// If any of those change, change this copy in the same commit. Note we do NOT
// claim mail bodies are unreadable to us: they are stored so the inbox works,
// and overstating that is how a trust badge becomes a liability.
const POP_W = 300;

export function SecurityBadge() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);

  // The sidebar sets overflow-x:hidden, which would clip a popover positioned
  // inside it, so the panel is portalled to the body and anchored to the chip.
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const r = chipRef.current?.getBoundingClientRect();
    if (r) {
      setPos({
        left: Math.min(Math.max(8, r.left), window.innerWidth - POP_W - 8),
        bottom: window.innerHeight - r.top + 8,
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!(e.target as Element).closest?.(".secure-pop, .secure-chip")) setOpen(false);
    }
    // A fixed panel would drift away from its anchor on scroll or resize.
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  // Escape at overlay priority, so it closes just this popover and never the
  // thread behind it. No catch-all: it is an explainer, not a modal.
  useHotkeys({ Escape: () => setOpen(false) }, { active: open, priority: KP.overlay });

  return (
    <div className="side-secure">
      <button
        ref={chipRef}
        className={`secure-chip ${open ? "on" : ""}`}
        onClick={toggle}
        aria-expanded={open}
        aria-label="How OneInbox protects your mail"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3l7 3v6c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-3z" />
          <path d="M9 12.2l2.1 2.1L15.2 10" />
        </svg>
        Encrypted and private
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            className="secure-pop"
            role="dialog"
            aria-label="How OneInbox protects your mail"
            style={{ left: pos.left, bottom: pos.bottom, width: POP_W }}
          >
            <h4>How your mail is protected</h4>
            <ul>
              <li>
                <b>Your password is never stored in the clear.</b> It is encrypted with
                AES-256-GCM before it reaches our database. With Google or Microsoft
                there is no password at all, just a token you can revoke.
              </li>
              <li>
                <b>Encrypted in transit.</b> Every connection to your mail provider runs
                over TLS.
              </li>
              <li>
                <b>Encrypted at rest, isolated to you.</b> Database rules keep your mail
                unreadable to every other customer.
              </li>
              <li>
                <b>Never sold, never used to train AI.</b> No AI reads your email
                unless you switch on the optional summaries add-on yourself, and
                even then only the conversations you ask it to summarize.
              </li>
            </ul>
            <p className="secure-foot">
              Disconnect an account and every message we hold for it is deleted.{" "}
              <a href="/privacy-policy" target="_blank" rel="noreferrer">
                Privacy policy
              </a>
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
}
