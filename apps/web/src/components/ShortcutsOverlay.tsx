import { ModalShell } from "./PlansModal.js";
import { KP, useHotkeys } from "../lib/keyboard.js";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const MOD = MAC ? "⌘" : "Ctrl";

// The "?" cheat sheet. ModalShell supplies Escape-to-close and the catch-all
// that deadens page keys; "?" toggling closed is bound here, and wins the tie
// with the catch-all because the parent registers after the child.
export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useHotkeys({ "?": () => onClose() }, { priority: KP.overlay });

  return (
    <ModalShell
      title="Keyboard shortcuts"
      sub="Fly through your mail without touching the mouse. Shortcuts pause while you type."
      onClose={onClose}
    >
      <div className="kbd-cols">
        <div className="kbd-sec">
          <h4>Get around</h4>
          <Row label="Next conversation" keys={["J"]} />
          <Row label="Previous conversation" keys={["K"]} />
          <Row label="Open the selected one" keys={["Enter"]} />
          <Row label="Back to the list" keys={["Esc"]} />
          <Row label="Search every inbox" keys={["/"]} />
          <Row label="New message" keys={["C"]} />
          <Row label="This cheat sheet" keys={["?"]} />
        </div>
        <div className="kbd-sec">
          <h4>Jump to a view</h4>
          <Row label="Inbox" keys={["G", "I"]} />
          <Row label="Starred" keys={["G", "S"]} />
          <Row label="Snoozed" keys={["G", "H"]} />
          <Row label="Sent" keys={["G", "T"]} />
          <Row label="Archived" keys={["G", "E"]} />
          <Row label="Deleted" keys={["G", "D"]} />
        </div>
        <div className="kbd-sec">
          <h4>Act on a conversation</h4>
          <Row label="Archive" keys={["E"]} />
          <Row label="Snooze" keys={["H"]} />
          <Row label="Star" keys={["S"]} />
          <Row label="Delete" keys={["#"]} />
          <Row label="Reply" keys={["R"]} />
          <Row label="Summarize (AI add-on)" keys={["I"]} />
        </div>
        <div className="kbd-sec">
          <h4>Write</h4>
          <Row label="Send" keys={[MOD, "Enter"]} />
          <p className="kbd-note">
            Snippets: type <b>;shortcut</b> then a space anywhere in a message.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}

function Row({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="kbd-row">
      <span>{label}</span>
      <span className="keys">
        {keys.map((k) => (
          <kbd key={k}>{k}</kbd>
        ))}
      </span>
    </div>
  );
}
