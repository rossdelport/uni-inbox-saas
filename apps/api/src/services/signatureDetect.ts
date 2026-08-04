// Detect an account's email signature from its own sent mail, byte-identical
// to what the user's provider composer appends.
//
// Two passes:
//  1. Marker pass. Gmail wraps signatures in <div class="gmail_signature">,
//     Outlook in <div id="Signature">. When the same marked block appears in
//     two or more sent messages, that block IS the signature, verbatim.
//  2. Suffix pass, for IMAP accounts sent from clients without a marker. After
//     cutting quoted history, the longest common HTML suffix shared by most
//     recent sent messages is taken, trimmed to a tag boundary. Exact bytes
//     from the newest message, or nothing: a wrong guess would put words in
//     the user's mouth, so under-detecting beats over-detecting.

const QUOTE_MARKERS = [
  /<div[^>]*class="[^"]*gmail_quote/i,
  /<blockquote/i,
  /<div[^>]*id="appendonsend"/i,
  /-{5,}\s*Original Message/i,
];

/** Cut the quoted reply chain off, keeping only freshly written content. */
function stripQuoted(html: string): string {
  let cut = html.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(html);
    if (m && m.index < cut) cut = m.index;
  }
  return html.slice(0, cut);
}

/** Extract a provider-marked signature block with balanced div scanning. */
function extractMarked(html: string): string | null {
  const open = /<div[^>]*(?:class="[^"]*gmail_signature[^"]*"|id="Signature")[^>]*>/i.exec(html);
  if (!open) return null;
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = open.index;
  let depth = 0;
  let t: RegExpExecArray | null;
  while ((t = tags.exec(html))) {
    if (t[0].startsWith("</")) depth -= 1;
    else if (!t[0].endsWith("/>")) depth += 1;
    if (depth === 0) return html.slice(open.index, tags.lastIndex);
  }
  return null;
}

function normalize(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}

/** Crude but adequate text rendering for the multipart/plain alternative. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectSignature(
  bodies: string[],
): { html: string; hits: number; method: "marker" | "suffix" } | null {
  // Pass 1: provider markers.
  const marked = new Map<string, { count: number; original: string }>();
  for (const body of bodies) {
    const sig = extractMarked(body);
    if (!sig) continue;
    const key = normalize(sig);
    if (htmlToText(sig).length < 2) continue; // empty signature blocks exist
    const entry = marked.get(key);
    if (entry) entry.count += 1;
    else marked.set(key, { count: 1, original: sig });
  }
  let best: { count: number; original: string } | null = null;
  for (const entry of marked.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  if (best && (best.count >= 2 || bodies.length === 1)) {
    return { html: best.original, hits: best.count, method: "marker" };
  }

  // Pass 2: common suffix across recent sent mail.
  const tails = bodies
    .map((b) => stripQuoted(b).trimEnd())
    .filter((b) => b.length > 0)
    .map((b) => b.slice(-4000));
  if (tails.length < 3) return null;

  const ref = tails[0]!;
  const suffixLens = tails.slice(1).map((t) => {
    let n = 0;
    while (n < ref.length && n < t.length && ref[ref.length - 1 - n] === t[t.length - 1 - n]) n += 1;
    return n;
  });
  // The suffix must be shared by at least 60% of the other samples.
  suffixLens.sort((a, b) => b - a);
  const need = Math.max(2, Math.ceil(suffixLens.length * 0.6));
  const shared = suffixLens[need - 1] ?? 0;
  if (shared < 80) return null;

  let sig = ref.slice(ref.length - shared);
  // Align to a tag boundary so we never start mid-attribute.
  const firstTag = sig.indexOf("<");
  if (firstTag > 0) sig = sig.slice(firstTag);
  if (firstTag < 0) return null;
  // Reject markup-only matches (shared closing tags, empty wrappers).
  if (htmlToText(sig).length < 10) return null;
  return { html: sig, hits: need + 1, method: "suffix" };
}
