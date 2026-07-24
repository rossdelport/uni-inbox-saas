# OneInbox Website

Static marketing site for OneInbox: "All your project inboxes, in one dashboard."
Plain HTML/CSS/JS. **No build step, no dependencies, no environment variables.**

## Pages

| Route | File |
|---|---|
| `/` | `index.html` |
| `/pricing` | `pricing/index.html` |
| `/solutions` | `solutions/index.html` |
| `/contacts` | `contacts/index.html` |
| `/privacy-policy` | `privacy-policy/index.html` |
| 404 | `404/index.html` (+ `404.html` copy that Vercel uses for unmatched routes) |

## Architecture (important before editing)

The site was built with Framer, then rebranded. Two layers matter when editing:

1. **Framer runtime** — each page loads `assets/framer/script_main.*.mjs`, which
   dynamic-imports route/shared chunks from `assets/framer/`. All chunks are local;
   nothing is required from framerusercontent.com at runtime except hotlinked images.
   User-visible strings live inside those `.mjs` chunks (already rebranded).

2. **OneInbox patcher** — every page ends with two inline blocks:
   - `<style>` starting with `/* ==== OneInbox custom ==== */` (custom components:
      search animation, FAQ accordion, pricing cards, Other-tab animation)
   - a final `<script>` (an IIFE containing `patchTabs`, `patchPricing`, etc.)
      that rebrands the DOM at runtime: header logo, provider pills/icons,
      dashboard tabs, custom pricing cards, FAQ, footer.

When editing custom components (pricing cards, FAQ content, search animation),
edit the inline block and **keep every page's copy in sync** (the same two blocks
are inlined into all 6 HTML files). The custom pricing cards/FAQ are injected by
the patcher at runtime; the original Framer plan cards are hidden by it.

## Known state / TODO

- Homepage + pricing page: fully rebranded.
- solutions / contacts / privacy-policy: structure and chrome (nav, footer, logo)
  rebranded, but body copy is still original template text.
- Images are hotlinked to `framerusercontent.com`. For full independence, download
  them into `assets/images/` and rewrite the URLs.
- Each page still includes Framer's analytics tag
  (`<script async src="https://events.framer.com/script" ...>`), safe to delete.

## Deploy (Vercel)

Static site. Framework preset **Other**, no build command, output dir = repo root.
`vercel.json` (cleanUrls) is included. `404.html` is picked up automatically as
the not-found page.
