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
| `/privacy` | `privacy.html` (Google OAuth privacy-policy URL) |
| `/privacy-policy` | `privacy-policy/index.html` (hand-written page, no Framer runtime) |
| `/service` | `service/index.html` (Terms of Service, hand-written page, no Framer runtime) |
| 404 | `404/index.html` (+ `404.html` copy that Vercel uses for unmatched routes) |

## Architecture (important before editing)

The site was built with Framer, then rebranded. **The homepage no longer loads
the Framer runtime**; the other Framer-exported pages still do.

### Homepage (`index.html`) — single self-contained file, no Framer runtime

Everything is inline: the SSR markup (all breakpoint variants stay in the DOM,
media queries switch them), the stylesheet, `landing-positioning.css/.js`,
`footer-links.js`, and a small "uni static runtime" that stands in for what the
runtime used to do:

- **Scroll-in section reveals** — sections ship with inline
  `opacity:0;transform:translateY(150px)`; an IntersectionObserver plays the
  rise-and-fade once per section as it enters the viewport.
- **Testimonials ticker** — the two rows are cloned to 12 items and slid at
  40px/s (row 1 left, row 2 right) with a seamless one-set loop, matching the
  runtime's marquee.
- **Mobile testimonials carousel** — a scroll-snap track built from the
  runtime's own card DOM, wired to the SSR dots pill.
- **Hamburger menu** — swaps the nav between the SSR `mobile-closed` markup and
  the captured `mobile-opened` variant, with a height tween.
- The nav/hero appear animation was already driven by the inline `animator`
  script and still is. Footer Privacy/Terms links are baked into the markup.

Edits to the homepage markup now stick: there is no hydration to revert them.
The conversion was produced by `tools/build-single-homepage.py` (kept with its
captured inputs for reference and for converting the other pages); hand-edits
are fine too, it is just HTML.

### Other Framer pages (pricing, solutions, contacts, lpwaitlist)

1. **Framer runtime** — each page loads `assets/framer/script_main.*.mjs`, which
   dynamic-imports route/shared chunks from `assets/framer/`. All chunks are local;
   nothing is required from framerusercontent.com at runtime except hotlinked images.
   User-visible strings live inside those `.mjs` chunks (already rebranded).
   Hydration reverts hand-edits on these pages a moment after load, which is why
   their fixes live in post-hydration scripts (`footer-links.js`,
   `landing-positioning.js` on the waitlist page).

2. **OneInbox patcher** — every page ends with two inline blocks:
   - `<style>` starting with `/* ==== OneInbox custom ==== */` (custom components:
      search animation, FAQ accordion, pricing cards, Other-tab animation)
   - a final `<script>` (an IIFE containing `patchTabs`, `patchPricing`, etc.)
      that rebrands the DOM at runtime: header logo, provider pills/icons,
      dashboard tabs, custom pricing cards, FAQ, footer.

When editing custom components (pricing cards, FAQ content, search animation),
edit the inline block and **keep every page's copy in sync** (the same two blocks
are inlined into the Framer pages and the homepage; the homepage copy has two
intentional differences: the envelope reveal gate fires immediately and
`patchTabs` skips hidden breakpoint variants). `landing-positioning.js` patches
every matching node (`each`/`findTexts`) because the no-runtime homepage keeps
all breakpoint variants in the DOM; the hydrated pages simply have one match.

## Known state / TODO

- Homepage: fully rebranded, single-file, no Framer runtime (see above).
- Pricing page: fully rebranded, still on the Framer runtime.
- solutions / contacts / privacy-policy: structure and chrome (nav, footer, logo)
  rebranded, but body copy is still original template text.
- Every page's footer (or bottom nav on the hand-written legal pages) links to
  both `/privacy` and `/service`.
- Images and fonts are hotlinked to `framerusercontent.com`. For full
  independence, download them into `assets/images/` and rewrite the URLs.
- `assets/framer/` is only needed by the non-homepage Framer pages now; it can
  be deleted once those are converted the same way.

## Deploy (Vercel)

Static site. Framework preset **Other**, no build command, output dir = repo root.
`vercel.json` (cleanUrls) is included. `404.html` is picked up automatically as
the not-found page.
