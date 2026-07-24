import { useRef, useState } from "react";
import { useReply, type OutgoingAttachment } from "../lib/queries.js";
import { toast } from "../lib/toast.js";

const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

// Rich reply box: formatting toolbar over a contentEditable body, attachment
// chips, and a send button that stays grey until there is something to send.
export function ReplyComposer({
  threadId,
  replyTo,
  accountEmail,
}: {
  threadId: string;
  replyTo: string;
  accountEmail: string;
}) {
  const reply = useReply();
  const editRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");

  const canSend = (!empty || files.length > 0) && !reply.isPending;

  function syncEmpty() {
    setEmpty(!(editRef.current?.innerText ?? "").trim());
  }

  // execCommand is legacy but universally supported and exactly the right
  // size for an email reply box. Toolbar buttons preventDefault on mousedown
  // so the text selection in the editor survives the click.
  function exec(cmd: string, val?: string) {
    editRef.current?.focus();
    document.execCommand(cmd, false, val);
    syncEmpty();
  }

  function addLink() {
    const url = window.prompt("Link address (https://...)");
    if (!url) return;
    exec("createLink", /^https?:\/\//i.test(url) ? url : `https://${url}`);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const next = [...files, ...Array.from(list)];
    if (next.length > MAX_FILES) {
      toast(`Up to ${MAX_FILES} attachments per message.`, "warn");
      return;
    }
    if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
      toast("Attachments are limited to 15 MB per message.", "warn");
      return;
    }
    setFiles(next);
  }

  const splitAddrs = (s: string) =>
    s
      .split(/[,;\s]+/)
      .map((a) => a.trim())
      .filter((a) => a.includes("@"));

  async function send() {
    const el = editRef.current;
    if (!el || !canSend) return;
    const ccList = splitAddrs(cc);
    const bccList = splitAddrs(bcc);
    const body_text = el.innerText.replace(/ /g, " ").trim();
    const attachments: OutgoingAttachment[] = await Promise.all(
      files.map(async (f) => ({
        filename: f.name,
        content_type: f.type || undefined,
        data_base64: await fileToBase64(f),
      })),
    );
    reply.mutate(
      {
        threadId,
        body_text: body_text || "(attachment)",
        body_html: `<div style="font-family:-apple-system,system-ui,sans-serif;font-size:14px;line-height:1.6">${el.innerHTML}</div>`,
        attachments: attachments.length > 0 ? attachments : undefined,
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
      },
      {
        onSuccess: () => {
          el.innerHTML = "";
          setFiles([]);
          setEmpty(true);
          setCc("");
          setBcc("");
          setShowCc(false);
          toast(`Reply sent from ${accountEmail}`, "success");
        },
      },
    );
  }

  const stop = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="read-reply">
      <div className="rc-bar">
        <button className="rc-btn" title="Bold" onMouseDown={stop} onClick={() => exec("bold")}>
          <b>B</b>
        </button>
        <button className="rc-btn" title="Italic" onMouseDown={stop} onClick={() => exec("italic")}>
          <i>I</i>
        </button>
        <button className="rc-btn" title="Underline" onMouseDown={stop} onClick={() => exec("underline")}>
          <u>U</u>
        </button>
        <button className="rc-btn" title="Strikethrough" onMouseDown={stop} onClick={() => exec("strikeThrough")}>
          <s>S</s>
        </button>
        <span className="rc-sep" />
        <select
          className="rc-size"
          title="Text size"
          defaultValue="3"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => exec("fontSize", e.target.value)}
        >
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
        </select>
        <span className="rc-sep" />
        <button className="rc-btn" title="Bulleted list" onMouseDown={stop} onClick={() => exec("insertUnorderedList")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M9 6h11M9 12h11M9 18h11" />
            <circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button className="rc-btn" title="Numbered list" onMouseDown={stop} onClick={() => exec("insertOrderedList")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M10 6h10M10 12h10M10 18h10M4 5.5h1.5v3M3.8 11h2.2l-2 2.5h2M4 16.5h1.6a.9.9 0 0 1 0 1.8H4.8a.9.9 0 0 0 0 1.8H6" />
          </svg>
        </button>
        <button className="rc-btn" title="Add link" onMouseDown={stop} onClick={addLink}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </svg>
        </button>
        <button className="rc-btn" title="Clear formatting" onMouseDown={stop} onClick={() => exec("removeFormat")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 4h12M12 4l-3 16M4 20l14-14" />
          </svg>
        </button>
        <span className="rc-sep" />
        <button className="rc-btn" title="Attach files" onMouseDown={stop} onClick={() => fileRef.current?.click()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.4 11.05l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 1 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          className="rc-btn"
          style={{ width: "auto", padding: "0 9px", marginLeft: "auto", fontSize: 11, fontWeight: 700 }}
          title="Add Cc or Bcc recipients"
          onMouseDown={stop}
          onClick={() => setShowCc((v) => !v)}
        >
          Cc/Bcc
        </button>
      </div>

      {showCc && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div className="field" style={{ marginTop: 0 }}>
            <label>Cc</label>
            <input
              placeholder="name@example.com"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginTop: 0 }}>
            <label>Bcc</label>
            <input
              placeholder="name@example.com"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
            />
          </div>
        </div>
      )}

      <div
        ref={editRef}
        className="rc-edit"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={`Reply to ${replyTo}...`}
        onInput={syncEmpty}
      />

      {files.length > 0 && (
        <div className="rc-atts">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="rc-att">
              📎 {f.name} ({Math.max(1, Math.round(f.size / 1024))} KB)
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {reply.error && <p className="err">{(reply.error as Error).message}</p>}
      <div className="rr-bar">
        <span className="rr-note">Sends from {accountEmail}</span>
        <button className="btn-sm" disabled={!canSend} onClick={() => void send()}>
          {reply.isPending ? "Sending…" : "Reply"}
        </button>
      </div>
    </div>
  );
}

async function fileToBase64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
