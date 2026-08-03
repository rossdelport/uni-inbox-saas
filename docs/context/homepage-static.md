# Homepage is a single static HTML file (no Framer runtime)

As of 2026-08-04, `site/index.html` no longer loads the Framer runtime
(`assets/framer/script_main.*.mjs` + 15 chunk preloads, ~6MB of JS). It is one
self-contained file: SSR markup, all CSS, and all JS inline. Only images/fonts
(framerusercontent.com hotlinks) and `/assets/logo.png` are external.

## Why

Hydration kept reverting hand-edits (footer Terms link, hero copy, envelope
positions), forcing an ever-growing pile of post-hydration patch scripts and
MutationObservers. With the runtime gone, edits to the markup stick.

## What the runtime actually did, and what replaced it

| Runtime behavior | Static replacement |
|---|---|
| Hydration (reverted edits) | gone; nothing reverts markup |
| Nav + hero appear animation | inline `animator` script (was already inline) |
| Scroll-in section reveals (10 sections ship `opacity:0;translateY(150px)`) | IntersectionObserver + WAAPI, once per section |
| Testimonials ticker marquee | rows cloned to 12 items, WAAPI translateX at 40px/s, row 1 left / row 2 right, seamless one-set loop |
| Mobile testimonials carousel (SSR ships 16 hidden template cards, no controls wired) | scroll-snap track with the 4 hydrated-final cards, SSR dots pill wired up |
| Mobile hamburger (only `mobile-closed` in SSR) | captured `mobile-opened` variant swapped in with a height tween |
| Envelope resting positions (SSR ships appear-offset transforms with nulled appear entries) | offsets cleared in the markup |
| Re-rendering copy from chunk data (kept SSR text stale) | `landing-positioning.js` now patches every matching node |

## Conversion pipeline

`site/tools/build-single-homepage.py` transforms the pre-conversion (Framer
runtime) index.html; every replacement asserts its exact match count.
`site/tools/inputs/` holds the two DOM captures from the hydrated page
(mobile-opened nav, carousel cards). To convert another page the same way,
follow the same recipe; the pitfalls that will bite are listed below.

## Pitfalls discovered (apply to converting the other pages)

- SSR keeps ALL breakpoint variants in the DOM (`.ssr-variant`, hidden-*
  classes); hydration used to cull them to one tree. Every `querySelector`
  first-match patch silently misses the tablet/mobile copies; patch all
  matches (`each`/`findTexts` in landing-positioning.js).
- Sections/components ship hidden initial states in inline styles
  (`opacity:0`, `opacity:0.001`) that only the runtime revealed: scroll
  sections, ticker row wrappers, carousel section. All must be revealed or
  wired to a reveal.
- The SSR export's minifier ate whitespace between styled `<span>`s in rich
  text ("Workswith all youremail providers"); hydration used to re-render it
  correctly. Grep for `</span>\w` and `\w<span` when converting.
- SSR text can differ from chunk text for the same node ("you are" vs
  "you're"), so copy-matchers need both variants.
- Full-page (captureBeyondViewport) screenshots are misleading for
  verification: scroll reveals never fire, and the viewport resize restarts
  finite CSS entrance animations mid-capture (notification cards blank in the
  shot but fine live). Verify with real scroll-throughs and viewport shots.

## Verification done

Old (runtime) vs new (static) served side by side, scroll-through then
full-page diff at 1440/1000/390: 0.77% / 0.91% / 0.64% differing pixels, all
remaining bands classified (22 crops reviewed) as animation-phase or ±4-15px
cascade offsets; no content differences. Interactions tested on the static
page: hamburger open/close, carousel swipe + dots, marquee velocity ±40px/s,
FAQ accordion, pricing slider + yearly toggle, CTA click-guard, reduced-motion
(everything visible), zero console errors. lpwaitlist (still on the runtime,
shares landing-positioning.js) regression-tested clean.

## Still on the Framer runtime

pricing, solutions, contacts, lpwaitlist. `assets/framer/` stays until they
are converted. The inline patcher blocks are still shared across pages; the
homepage copy has two intentional divergences (mails gate fires immediately;
patchTabs skips zero-width variants).
