import { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { useTheme } from "@/lib/theme";

// Renders one HTML mail body. The server sanitized this HTML at ingest
// (sanitize-html strips scripts and event handlers before anything is
// stored), and buildDoc re-strips both as defense in depth, mirroring the
// web client's DOMPurify second layer. Remote images are blocked by default
// so tracking pixels don't fire on open, same as the web.
//
// Height: a WebView does not size to its content, so an injected script
// reports the content height back over postMessage and the native view gets
// that height, letting the whole thread scroll as one list.

const MEASURE = `
(function () {
  var last = 0;
  function report() {
    // Measure the wrapper, NOT documentElement: the root element's
    // scrollHeight is floored at the viewport height, and the viewport IS
    // this WebView's current native height. Feeding that back as the new
    // height makes it a fixed point that can only ever grow, and mail with
    // viewport-relative sizing (min-height:100vh, which the sanitizer
    // passes through) grows it every cycle until the clamp: one marketing
    // email became a 20,000px blank card. offsetHeight on a static wrapper
    // depends only on the content, so it can shrink and it cannot chase
    // its own output.
    var el = document.getElementById("oi-root");
    if (!el) return;
    var h = Math.ceil(el.getBoundingClientRect().height);
    if (h > 0 && Math.abs(h - last) > 2) {
      last = h;
      window.ReactNativeWebView.postMessage(String(h));
    }
  }
  report();
  window.addEventListener("load", report);
  setTimeout(report, 80);
  setTimeout(report, 400);
  setTimeout(report, 1200);
  try { new ResizeObserver(report).observe(document.getElementById("oi-root")); } catch (e) {}
})();
true;
`;

/** Strip event handlers, but only inside tags. Running the handler regex
 *  over the whole document also eats ordinary prose (" once=" and friends)
 *  out of the visible text, and half-matching an attribute could unbalance
 *  the quoting around it. */
function stripHandlers(html: string): string {
  return html.replace(/<[a-zA-Z/!][^>]*>/g, (tag) =>
    tag.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, ""),
  );
}

function buildDoc(bodyHtml: string, loadImages: boolean): { doc: string; hadRemote: boolean } {
  let clean = stripHandlers(bodyHtml.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ""));
  const hadRemote =
    /<img[^>]+src\s*=\s*["']https?:\/\//i.test(clean) ||
    /url\(\s*["']?https?:\/\//i.test(clean);
  if (!loadImages) {
    clean = clean
      .replace(/(<img[^>]+src\s*=\s*["'])https?:\/\/[^"']*(["'])/gi, "$1$2")
      // CSS background images are tracking pixels just as often as <img>
      // is, and they load exactly the same way.
      .replace(/url\(\s*["']?https?:\/\/[^)]*\)/gi, "url()");
  }
  // Inline cid: images point at IMAP attachment parts this view can't fetch;
  // blank them so they hide instead of rendering broken glyphs.
  clean = clean.replace(/(<img[^>]+src\s*=\s*["'])cid:[^"']*(["'])/gi, "$1$2");
  const doc =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">` +
    // Email HTML almost always assumes a light background, so this stays a
    // white card even in dark mode (what Apple Mail does for rich mail too).
    `<style>html,body{margin:0;padding:0;background:#fff}` +
    `#oi-root{font:15px/1.6 -apple-system,system-ui,sans-serif;color:#0A2540;` +
    `padding:2px;word-break:break-word;overflow:hidden}` +
    `#oi-root img{max-width:100%;height:auto}` +
    `#oi-root img[src=""],#oi-root img:not([src]){display:none}` +
    `#oi-root table{max-width:100%}` +
    `#oi-root a{color:#0B6FE6}</style></head>` +
    `<body><div id="oi-root">${clean}</div></body></html>`;
  return { doc, hadRemote };
}

export function HtmlBody({ bodyHtml }: { bodyHtml: string }) {
  const t = useTheme();
  const [loadImages, setLoadImages] = useState(false);
  const [height, setHeight] = useState(140);
  const { doc, hadRemote } = useMemo(() => buildDoc(bodyHtml, loadImages), [bodyHtml, loadImages]);

  // Nothing navigates inside the message: the card must always still be the
  // message after a tap. Only the initial document load is allowed through.
  // http(s) and mailto: hand off to the OS; everything else is refused
  // outright, which matters because the sanitizer keeps data: hrefs and a
  // data:text/html link would otherwise replace the card with
  // attacker-authored HTML, in a WebView that has JS enabled for measuring.
  //
  // The document is loaded with an explicit about:blank base so the initial
  // request has a stable, recognisable URL. Without it Android loads the
  // body as a data:text/html URL, which is indistinguishable from a crafted
  // data:text/html link, and allowing the one would allow the other.
  const onNav = (req: WebViewNavigation): boolean => {
    const url = req.url ?? "";
    // Matching the whole about: scheme, not the exact string: getting this
    // wrong in the strict direction blanks every message card, which is far
    // worse than allowing about:srcdoc.
    if (url === "" || url.startsWith("about:")) return true;
    if (/^(https?|mailto|tel):/i.test(url)) {
      void Linking.openURL(url).catch(() => {
        /* no mail client configured, nothing sensible to show */
      });
    }
    return false;
  };

  return (
    <View>
      {hadRemote && !loadImages ? (
        <Pressable
          onPress={() => setLoadImages(true)}
          style={({ pressed }) => [
            styles.imgBtn,
            { backgroundColor: t.chipBg, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.imgBtnText, { color: t.sub }]}>Load remote images</Text>
        </Pressable>
      ) : null}
      <WebView
        originWhitelist={["*"]}
        source={{ html: doc, baseUrl: "about:blank" }}
        injectedJavaScript={MEASURE}
        onMessage={(e) => {
          const h = Number(e.nativeEvent.data);
          if (Number.isFinite(h) && h > 0) setHeight(Math.min(Math.max(h + 8, 40), 20_000));
        }}
        onShouldStartLoadWithRequest={onNav}
        style={[styles.web, { height }]}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        setSupportMultipleWindows={false}
        allowsLinkPreview={false}
        // The measuring script above is the only JS that runs: scripts inside
        // the mail itself were stripped server-side and again in buildDoc.
        javaScriptEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  imgBtn: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 8,
  },
  imgBtnText: { fontSize: 12, fontWeight: "600" },
  web: { backgroundColor: "#fff", borderRadius: 8 },
});
