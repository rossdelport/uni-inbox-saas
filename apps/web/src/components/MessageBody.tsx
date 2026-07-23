import { useMemo, useState } from "react";
import DOMPurify from "dompurify";

// Renders one message body. HTML mail goes through DOMPurify (defense in
// depth on top of the server-side sanitize) into a sandboxed iframe; remote
// images are blocked by default so tracking pixels don't fire on open.
export function MessageBody({
  bodyHtml,
  bodyText,
}: {
  bodyHtml: string | null;
  bodyText: string | null;
}) {
  const [loadImages, setLoadImages] = useState(false);

  const { doc, hadRemoteImages } = useMemo(() => {
    if (!bodyHtml) return { doc: null, hadRemoteImages: false };
    let clean = DOMPurify.sanitize(bodyHtml, { FORBID_TAGS: ["script", "iframe", "object"] });
    const hasRemote = /src\s*=\s*["']https?:\/\//i.test(clean);
    if (!loadImages) {
      clean = clean.replace(/(<img[^>]+src\s*=\s*["'])https?:\/\/[^"']*(["'])/gi, "$1$2");
    }
    const html =
      `<base target="_blank"><style>body{font:14px/1.6 -apple-system,system-ui,sans-serif;` +
      `color:#27272a;margin:0;padding:4px;word-break:break-word}` +
      `img{max-width:100%;height:auto}a{color:#4f46e5}</style>${clean}`;
    return { doc: html, hadRemoteImages: hasRemote };
  }, [bodyHtml, loadImages]);

  if (doc) {
    return (
      <div>
        {hadRemoteImages && !loadImages && (
          <button
            className="mb-2 rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200"
            onClick={() => setLoadImages(true)}
          >
            Load remote images
          </button>
        )}
        <iframe
          title="message"
          sandbox=""
          srcDoc={doc}
          className="w-full rounded-md border-0"
          style={{ minHeight: 120 }}
          onLoad={(e) => {
            // Size the frame to its content (sandbox blocks scripts inside).
            const frame = e.currentTarget;
            try {
              const h = frame.contentDocument?.body?.scrollHeight;
              if (h) frame.style.height = `${Math.min(h + 24, 1600)}px`;
            } catch {
              frame.style.height = "480px";
            }
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
