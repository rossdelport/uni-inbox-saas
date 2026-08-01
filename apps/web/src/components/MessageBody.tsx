import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { supabase } from "../lib/supabase.js";

function normalizeCid(value: string): string {
  let cid = value.trim().replace(/^cid:/i, "").replace(/^<|>$/g, "");
  try {
    cid = decodeURIComponent(cid);
  } catch {
    // A literal percent sign is valid in a content id. Keep it unchanged.
  }
  return cid.toLowerCase();
}

function inlineCids(bodyHtml: string | null): string[] {
  if (!bodyHtml) return [];
  const clean = DOMPurify.sanitize(bodyHtml, {
    FORBID_TAGS: ["script", "iframe", "object"],
    ADD_TAGS: ["picture", "source"],
    ADD_ATTR: ["srcset", "sizes", "media", "type"],
  });
  const parsed = new DOMParser().parseFromString(clean, "text/html");
  return Array.from(
    new Set(
      Array.from(parsed.querySelectorAll("img[src^='cid:' i]"))
        .map((img) => normalizeCid(img.getAttribute("src") ?? ""))
        .filter(Boolean),
    ),
  );
}

// Renders one message body. HTML mail goes through DOMPurify (defense in
// depth on top of the server-side sanitize) into a sandboxed iframe. Remote
// images load normally; inline cid: images are fetched through our auth gate.
export function MessageBody({
  messageId,
  bodyHtml,
  bodyText,
}: {
  messageId: string;
  bodyHtml: string | null;
  bodyText: string | null;
}) {
  const cids = useMemo(() => inlineCids(bodyHtml), [bodyHtml]);
  const [inlineImages, setInlineImages] = useState<Record<string, string>>({});

  // Inline images are MIME attachments referenced as cid:... in the HTML.
  // Fetch them with the user's bearer token, then give the sandbox a local
  // blob URL. This works for old messages too: the API re-reads the original
  // IMAP source and matches its Content-ID on demand.
  useEffect(() => {
    setInlineImages({});
    if (cids.length === 0) return;

    let cancelled = false;
    const objectUrls = new Set<string>();
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;

      const entries: Array<readonly [string, string]> = [];
      // Each endpoint call briefly opens this mailbox. Keep them sequential
      // so a newsletter with many logos cannot fan out into an IMAP storm.
      for (const cid of cids) {
        if (cancelled) break;
        try {
          const response = await fetch(
            `${import.meta.env.VITE_API_URL ?? ""}/api/messages/${messageId}/inline/${encodeURIComponent(cid)}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!response.ok) continue;
          const blob = await response.blob();
          if (!blob.type.toLowerCase().startsWith("image/")) continue;
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            break;
          }
          objectUrls.add(url);
          entries.push([cid, url] as const);
        } catch {
          // One broken inline part must not stop the rest of the email.
        }
      }
      if (!cancelled) {
        setInlineImages(Object.fromEntries(entries));
      }
    })();

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [cids, messageId]);

  const doc = useMemo(() => {
    if (!bodyHtml) return null;
    const clean = DOMPurify.sanitize(bodyHtml, {
      FORBID_TAGS: ["script", "iframe", "object"],
      ADD_TAGS: ["picture", "source"],
      ADD_ATTR: ["srcset", "sizes", "media", "type"],
    });
    const parsed = new DOMParser().parseFromString(clean, "text/html");

    parsed.querySelectorAll("img").forEach((img) => {
      const raw = (img.getAttribute("src") ?? "").trim();
      if (/^cid:/i.test(raw)) {
        const resolved = inlineImages[normalizeCid(raw)];
        if (resolved) img.setAttribute("src", resolved);
        else img.removeAttribute("src");
      } else if (
        raw &&
        !/^(?:https?:)?\/\//i.test(raw) &&
        !/^(?:data|blob):/i.test(raw)
      ) {
        // Email HTML has no trustworthy base URL. A relative source would hit
        // tryoneinbox.co and show a broken icon, so hide it cleanly instead.
        img.removeAttribute("src");
      }
      img.setAttribute("loading", "eager");
      img.setAttribute("referrerpolicy", "no-referrer");
    });

    parsed.querySelectorAll("a").forEach((anchor) => {
      anchor.setAttribute("rel", "noopener noreferrer");
      anchor.setAttribute("target", "_blank");
    });

    const html =
      `<base target="_blank"><style>body{font:14px/1.6 -apple-system,system-ui,sans-serif;` +
      `color:#0A2540;margin:0;padding:4px;word-break:break-word}` +
      `img{max-width:100%;height:auto}` +
      `img[src=""],img:not([src]){display:none}` +
      `a{color:#0B6FE6}</style>${parsed.body.innerHTML}`;
    return html;
  }, [bodyHtml, inlineImages]);

  if (doc) {
    return (
      <div>
        <iframe
          title="message"
          // allow-same-origin WITHOUT allow-scripts: content is inert (script
          // execution stays blocked) but the parent can measure its height.
          // With a fully opaque sandbox, contentDocument is unreachable and
          // the frame would be stuck at minHeight.
          //
          // allow-popups lets a clicked link actually open; without it the
          // sandbox swallows the navigation and links appear dead.
          // allow-popups-to-escape-sandbox keeps the opened tab a normal
          // browsing context instead of inheriting this frame's restrictions,
          // which would leave the destination site broken.
          //
          // This stays safe because allow-scripts is absent: no code in the
          // message can run, so a popup can only ever come from a real click.
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={doc}
          className="w-full rounded-md border-0"
          style={{ minHeight: 120 }}
          onLoad={(e) => {
            const frame = e.currentTarget;
            const size = () => {
              try {
                const body = frame.contentDocument?.body;
                body?.querySelectorAll("img").forEach((image) => {
                  const hideBroken = () => {
                    if (image.complete && image.naturalWidth === 0) image.style.display = "none";
                  };
                  image.addEventListener("error", () => {
                    image.style.display = "none";
                  }, { once: true });
                  hideBroken();
                });
                const h = body?.scrollHeight;
                if (h) frame.style.height = `${Math.min(h + 24, 5000)}px`;
              } catch {
                frame.style.height = "480px";
              }
            };
            size();
            // Late-loading images change the content height; re-measure.
            setTimeout(size, 600);
          }}
        />
      </div>
    );
  }

  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-700">
      {bodyText ?? "(empty message)"}
    </pre>
  );
}
