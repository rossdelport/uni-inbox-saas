import { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { useTheme } from "@/lib/theme";

// Renders one HTML mail body. The server sanitized this HTML at ingest
// (sanitize-html strips scripts and event handlers before anything is
// stored), and the regex pass below re-strips both as defense in depth,
// mirroring the web client's DOMPurify second layer. Remote images are
// blocked by default so tracking pixels don't fire on open, same as the web.
//
// Height: a WebView does not size to its content, so an injected script
// reports the document height back over postMessage and the native view gets
// that height, letting the whole thread scroll as one list. This is the
// classic time sink; if it misbehaves on device, MessageCard's plain-text
// path is one prop away.

const MEASURE = `
(function () {
  var last = 0;
  function report() {
    var h = Math.max(
      document.documentElement ? document.documentElement.scrollHeight : 0,
      document.body ? document.body.scrollHeight : 0
    );
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
  try { new ResizeObserver(report).observe(document.documentElement); } catch (e) {}
})();
true;
`;

function buildDoc(bodyHtml: string, loadImages: boolean): { doc: string; hadRemote: boolean } {
  let clean = bodyHtml
    // Belt and braces on top of the server-side sanitize.
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  const hadRemote = /src\s*=\s*["']https?:\/\//i.test(clean);
  if (!loadImages) {
    clean = clean.replace(/(<img[^>]+src\s*=\s*["'])https?:\/\/[^"']*(["'])/gi, "$1$2");
  }
  // Inline cid: images point at IMAP attachment parts this view can't fetch;
  // blank them so they hide instead of rendering broken glyphs.
  clean = clean.replace(/(<img[^>]+src\s*=\s*["'])cid:[^"']*(["'])/gi, "$1$2");
  const doc =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">` +
    // Email HTML almost always assumes a light background, so this stays a
    // white card even in dark mode (what Apple Mail does for rich mail too).
    `<style>body{font:15px/1.6 -apple-system,system-ui,sans-serif;color:#0A2540;` +
    `margin:0;padding:2px;word-break:break-word;background:#fff}` +
    `img{max-width:100%;height:auto}` +
    `img[src=""],img:not([src]){display:none}` +
    `table{max-width:100%}` +
    `a{color:#0B6FE6}</style></head><body>${clean}</body></html>`;
  return { doc, hadRemote };
}

export function HtmlBody({ bodyHtml }: { bodyHtml: string }) {
  const t = useTheme();
  const [loadImages, setLoadImages] = useState(false);
  const [height, setHeight] = useState(140);
  const { doc, hadRemote } = useMemo(() => buildDoc(bodyHtml, loadImages), [bodyHtml, loadImages]);

  // Every link opens in Safari; nothing navigates inside the message. The
  // initial content load arrives as about:blank / a data: url and must pass.
  const onNav = (req: WebViewNavigation): boolean => {
    if (/^https?:\/\//i.test(req.url)) {
      void Linking.openURL(req.url);
      return false;
    }
    return true;
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
        source={{ html: doc }}
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
