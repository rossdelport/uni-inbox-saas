import { useEffect, useState } from "react";
import { tint } from "../lib/colors.js";

// Real sender avatars, the way premium mail clients fake it without any API:
//  1. Gravatar for the exact address (sha256, d=404 so misses fail fast)
//  2. the sender domain's favicon for business senders (newsletters, receipts)
//  3. the tinted initial we already draw
// Results (including "nothing found") are cached per address for the session.

const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.com.au", "ymail.com", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "pm.me", "aol.com", "gmx.com", "gmx.de", "web.de",
  "mail.com", "bigpond.com", "fastmail.com", "hey.com", "zoho.com",
]);

const resolved = new Map<string, string | null>();

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function candidatesFor(email: string): Promise<string[]> {
  const list: string[] = [];
  list.push(`https://www.gravatar.com/avatar/${await sha256Hex(email)}?d=404&s=96`);
  const domain = email.split("@")[1] ?? "";
  if (domain.includes(".") && !FREEMAIL.has(domain)) {
    list.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`);
  }
  return list;
}

export function SenderAvatar({
  name,
  email,
  color,
}: {
  name: string | null;
  email: string | null;
  color: string;
}) {
  const key = (email ?? "").trim().toLowerCase();
  const [candidates, setCandidates] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setIdx(0);
    setOk(false);
    if (!key || !key.includes("@")) {
      setCandidates([]);
      return;
    }
    const hit = resolved.get(key);
    if (hit !== undefined) {
      setCandidates(hit ? [hit] : []);
      setOk(false);
      return;
    }
    let live = true;
    void candidatesFor(key).then((c) => {
      if (live) setCandidates(c);
    });
    return () => {
      live = false;
    };
  }, [key]);

  const src = candidates[idx];
  return (
    <div className="ava" style={{ ...tint(color), position: "relative", overflow: "hidden" }}>
      {(name || email || "?").charAt(0).toUpperCase()}
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: ok ? 1 : 0,
            background: "#fff",
          }}
          onLoad={(e) => {
            setOk(true);
            resolved.set(key, e.currentTarget.src);
          }}
          onError={() => {
            setOk(false);
            if (idx + 1 < candidates.length) setIdx(idx + 1);
            else {
              resolved.set(key, null);
              setCandidates([]);
            }
          }}
        />
      )}
    </div>
  );
}
