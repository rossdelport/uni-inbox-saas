import { useEffect, useRef, useState } from "react";
import {
  useCancelOutbox,
  useReply,
  useSnippets,
  type OutgoingAttachment,
  type QueuedSend,
} from "../lib/queries.js";
import { toast } from "../lib/toast.js";
import { KP, useHotkeys } from "../lib/keyboard.js";
import { onComposerDirty, onReplyIntent } from "../lib/composerIntent.js";
import { ContactAutocompleteInput } from "./ContactAutocompleteInput.js";

const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

// Rich reply box: formatting toolbar over a contentEditable body, attachment
// chips, and a send button that stays grey until there is something to send.
/** Text the user actually typed: everything except the seeded signature. */
function typedText(el: HTMLElement | null): string {
  if (!el) return "";
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-oi-sig]").forEach((n) => n.remove());
  return (clone.textContent ?? "").trim();
}

export function ReplyComposer({
  threadId,
  replyTo,
  accountEmail,
  signatureHtml,
}: {
  threadId: string;
  replyTo: string;
  accountEmail: string;
  signatureHtml?: string | null;
}) {
  const reply = useReply();
  const editRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const { data: snippetData } = useSnippets();
  const snippets = snippetData?.snippets ?? [];
  const [snipOpen, setSnipOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const cancelOutbox = useCancelOutbox();
  // The undo window: the queued send plus everything needed to put the draft
  // back if the user pulls it. Held here, not in the outbox row, so undo can
  // restore the exact editor HTML and the original File objects.
  const [pendingUndo, setPendingUndo] = useState<null | {
    outboxId: string;
    until: number;
    html: string;
    files: File[];
    cc: string;
    bcc: string;
  }>(null);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!pendingUndo) return;
    const t = setInterval(() => {
      if (Date.now() >= pendingUndo.until) setPendingUndo(null);
      else forceTick((n) => n + 1);
    }, 250);
    return () => clearInterval(t);
  }, [pendingUndo]);

  // Synchronous send latch. `reply.isPending` only flips once mutate() is
  // called, and send() awaits fileToBase64 for every attachment first, so for
  // the whole file-reading window isPending is false and canSend stayed true.
  // Double-clicking Send on a reply with attachments sent the email twice, and
  // a sent email cannot be recalled. A ref, not state: it has to be set and
  // read in the same tick, before React ever re-renders.
  const sendingRef = useRef(false);
  const canSend = (!empty || files.length > 0) && !reply.isPending;

  // "r" in the reading pane lands the caret here.
  useEffect(
    () =>
      onReplyIntent(() => {
        editRef.current?.focus();
        editRef.current?.scrollIntoView({ block: "nearest" });
      }),
    [],
  );
  // Unsent content, read live: keyboard actions that would unmount this
  // component check it before navigating, because the body lives in an
  // uncontrolled contentEditable that unmounting destroys.
  const draftRef = useRef({ files, cc, bcc });
  draftRef.current = { files, cc, bcc };
  useEffect(
    () =>
      onComposerDirty(() => {
        const d = draftRef.current;
        return (
          Boolean(typedText(editRef.current)) ||
          d.files.length > 0 ||
          d.cc.trim().length > 0 ||
          d.bcc.trim().length > 0
        );
      }),
    [],
  );
  // Escape closes the snippet and send-later popovers before anything below
  // them (like the reading pane's back) can see it.
  useHotkeys(
    {
      Escape: () => {
        setSnipOpen(false);
        setLaterOpen(false);
      },
    },
    { active: snipOpen || laterOpen, priority: KP.overlay },
  );

  function syncEmpty() {
    setEmpty(!typedText(editRef.current));
  }

  // Seed the account's signature into the editor, exactly as stored, with two
  // writing lines above it. Only when nothing has been typed, so remounts and
  // undo restores never clobber a draft.
  useEffect(() => {
    const el = editRef.current;
    if (!el || !signatureHtml) return;
    if (typedText(el) || el.querySelector("[data-oi-sig]")) return;
    el.innerHTML =
      '<div><br></div><div><br></div><div data-oi-sig="1">' + signatureHtml + "</div>";
    // Caret goes to the top line, where the reply starts.
    const sel = window.getSelection();
    if (sel && el.firstChild) {
      const range = document.createRange();
      range.setStart(el.firstChild, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureHtml]);

  // ;shortcode expansion, Superhuman style: typing ";intro " swaps the token
  // for the snippet at the caret. Runs on every input; the regex only looks
  // at the text node the caret sits in, so it costs nothing.
  function maybeExpandSnippet() {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!sel || !node || node.nodeType !== Node.TEXT_NODE || snippets.length === 0) return;
    const text = node.textContent ?? "";
    const upTo = text.slice(0, sel.anchorOffset);
    const m = /;([a-z0-9_-]+)[\s\u00a0]$/i.exec(upTo);
    if (!m) return;
    const snip = snippets.find((x) => x.shortcut === m[1]!.toLowerCase());
    if (!snip) return;
    const range = document.createRange();
    range.setStart(node, sel.anchorOffset - m[0].length);
    range.setEnd(node, sel.anchorOffset);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand(
      "insertHTML",
      false,
      snip.body_html ?? snip.body_text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>"),
    );
    syncEmpty();
  }

  function insertSnippet(id: string) {
    const snip = snippets.find((x) => x.id === id);
    if (!snip) return;
    editRef.current?.focus();
    document.execCommand(
      "insertHTML",
      false,
      snip.body_html ?? snip.body_text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>"),
    );
    setSnipOpen(false);
    syncEmpty();
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

  async function send(sendAt?: string) {
    const el = editRef.current;
    if (!el || !canSend || sendingRef.current) return;
    sendingRef.current = true;
    const stash = { html: el.innerHTML, files, cc, bcc };
    const ccList = splitAddrs(cc);
    const bccList = splitAddrs(bcc);
    const body_text = el.innerText.replace(/ /g, " ").trim();
    let attachments: OutgoingAttachment[];
    try {
      attachments = await Promise.all(
        files.map(async (f) => ({
          filename: f.name,
          content_type: f.type || undefined,
          data_base64: await fileToBase64(f),
        })),
      );
    } catch {
      // Nothing was sent, so the latch has to come off or the composer stays
      // dead until it remounts.
      sendingRef.current = false;
      toast("Could not read one of the attachments. Remove it and try again.", "warn");
      return;
    }
    reply.mutate(
      {
        threadId,
        body_text: body_text || "(attachment)",
        body_html: `<div style="font-family:-apple-system,system-ui,sans-serif;font-size:14px;line-height:1.6">${el.innerHTML}</div>`,
        attachments: attachments.length > 0 ? attachments : undefined,
        cc: ccList.length > 0 ? ccList : undefined,
        bcc: bccList.length > 0 ? bccList : undefined,
        send_at: sendAt,
      },
      {
        onSuccess: (data: QueuedSend) => {
          el.innerHTML = signatureHtml
            ? '<div><br></div><div><br></div><div data-oi-sig="1">' + signatureHtml + "</div>"
            : "";
          setFiles([]);
          setEmpty(true);
          setCc("");
          setBcc("");
          setShowCc(false);
          if (data.queued && sendAt) {
            toast(`Scheduled. It sends ${new Date(sendAt).toLocaleString()}.`, "success");
          } else if (data.queued && data.outbox_id && data.not_before) {
            // Undo window: keep the draft on ice until the worker may claim it.
            setPendingUndo({
              outboxId: data.outbox_id,
              until: new Date(data.not_before).getTime(),
              ...stash,
            });
          } else {
            toast(`Reply sent from ${accountEmail}`, "success");
          }
        },
        onSettled: () => {
          sendingRef.current = false;
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
        <span style={{ position: "relative" }}>
          <button
            className="rc-btn"
            title="Insert a snippet (or type ;shortcut in the message)"
            onMouseDown={stop}
            onClick={() => setSnipOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
            </svg>
          </button>
          {snipOpen && (
            <div className="snz-pop rc-snips" style={{ position: "absolute", top: 30, left: 0, width: 240 }}>
              {snippets.length === 0 ? (
                <p className="rc-snips-empty">
                  No snippets yet. Create them in Settings, then insert them here or by typing
                  ;shortcut in the message.
                </p>
              ) : (
                snippets.map((sn) => (
                  <button key={sn.id} className="snz-item" onMouseDown={stop} onClick={() => insertSnippet(sn.id)}>
                    <span>{sn.name}</span>
                    <i>;{sn.shortcut}</i>
                  </button>
                ))
              )}
            </div>
          )}
        </span>
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
            <ContactAutocompleteInput
              placeholder="name@example.com"
              value={cc}
              onChange={setCc}
            />
          </div>
          <div className="field" style={{ marginTop: 0 }}>
            <label>Bcc</label>
            <ContactAutocompleteInput
              placeholder="name@example.com"
              value={bcc}
              onChange={setBcc}
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
        onInput={() => {
          maybeExpandSnippet();
          syncEmpty();
        }}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter sends. Handled on the element because the global
          // layer deliberately ignores everything while typing.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void send();
          }
        }}
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
      {pendingUndo ? (
        <div className="rr-bar">
          <span className="rr-note">
            Sending in {Math.max(0, Math.ceil((pendingUndo.until - Date.now()) / 1000))}s…
          </span>
          <button
            className="btn-mini"
            disabled={cancelOutbox.isPending}
            onClick={() =>
              cancelOutbox.mutate(pendingUndo.outboxId, {
                onSuccess: () => {
                  // Put the draft back exactly as it was.
                  if (editRef.current) editRef.current.innerHTML = pendingUndo.html;
                  setFiles(pendingUndo.files);
                  setCc(pendingUndo.cc);
                  setBcc(pendingUndo.bcc);
                  setShowCc(Boolean(pendingUndo.cc || pendingUndo.bcc));
                  setPendingUndo(null);
                  syncEmpty();
                  toast("Send cancelled. Your draft is back.", "success");
                },
                onError: () => {
                  setPendingUndo(null);
                  toast("Too late to undo: it was already on its way.", "warn");
                },
              })
            }
          >
            Undo
          </button>
        </div>
      ) : (
        <div className="rr-bar">
          <span className="rr-note">Sends from {accountEmail}</span>
          <span style={{ position: "relative", display: "flex", gap: 6 }}>
            <button
              className="btn-mini"
              title="Send later"
              disabled={!canSend}
              onClick={() => setLaterOpen((v) => !v)}
            >
              ◷
            </button>
            {laterOpen && (
              <div className="snz-pop" style={{ position: "absolute", bottom: 34, right: 0, width: 210 }}>
                {sendLaterPresets().map((p) => (
                  <button
                    key={p.label}
                    className="snz-item"
                    onClick={() => {
                      setLaterOpen(false);
                      void send(p.when.toISOString());
                    }}
                  >
                    <span>{p.label}</span>
                    <i>{p.when.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</i>
                  </button>
                ))}
              </div>
            )}
            <button className="btn-sm" disabled={!canSend} onClick={() => void send()}>
              {reply.isPending ? "Sending…" : "Reply"}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Send Later presets: computed at open, never in the past. */
function sendLaterPresets(): Array<{ label: string; when: Date }> {
  const now = new Date();
  const out: Array<{ label: string; when: Date }> = [
    { label: "In 1 hour", when: new Date(now.getTime() + 3600_000) },
  ];
  const tonight = new Date(now);
  tonight.setHours(18, 0, 0, 0);
  if (tonight.getTime() > now.getTime() + 30 * 60_000) out.push({ label: "This evening", when: tonight });
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  tomorrow.setHours(8, 0, 0, 0);
  out.push({ label: "Tomorrow morning", when: tomorrow });
  return out;
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
