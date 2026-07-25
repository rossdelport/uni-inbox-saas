# Design north star: the Maily Framer site

**URL: https://maily-template.framer.website/**

Ross's call (2026-07-23): this is the exact UI/UX OneInbox will have, for the
marketing site and, in spirit, the dashboard. Treat it as the reference for
every visual decision. (It is published from the Maily Framer template; if we
reuse its actual assets/layout for the marketing site rather than just the
aesthetic, make sure the template license is on Ross's Framer account.)

## Status: digest COMPLETE (2026-07-23)

The full design system lives in [`maily-design-spec.md`](maily-design-spec.md)
(tokens, typography, radii, shadows, gradients, motion, per-page specs). The
marketing site built from it is deployed from `site/` at the domain root.

## Dashboard alignment: DONE (2026-07-25)

The /app dashboard now shares the site's design system. Tokens live at the top
of `apps/web/src/index.css`, and the "LANDING-PAGE ALIGNMENT PASS" section at
the bottom of that file carries the component-level rules. Values were measured
off the live site with Playwright rather than copied from this spec, because the
Framer export drifted from it. Ground truth captured:

- **Blue** `#0C7DFF` is the only accent. `--b1-ink` (`#0B6FE6`) is the same hue
  darkened for small text, since dashboard type runs 10-13px where the site runs
  15-18px and the raw brand blue fails 4.5:1 on white.
- **Ink** is navy-tinted `#0A2540`, never pure black (taken from the site's own
  app mockup in the "smart search" feature card, which renders `rgb(10,37,64)`).
- **Page background** `#F9F9F9`, neutral. The old dashboard used a blue-grey
  `#eef4fa` that exists nowhere on the site.
- **Shadows** are either the soft layered stack or a blue-tinted lift. The site
  never uses a hard grey drop shadow.
- **Buttons** are chunky pills: vertical gradient, inset white top highlight,
  and a hard (unblurred) bottom lip.
- **Radii** 14px rows, 20-24px cards, 32px panels.
- **Mail rows** are white cards with a hairline, matching the app mockup; the
  selected row glows in its own account colour.

Contrast was verified programmatically across every surface (see the audit
approach in the commit); the full app passes WCAG AA apart from the deliberately
greyed disabled send button.

The original capture checklist below is kept for reference only.

## Original status note: digest PENDING — do not guess

Cloud sessions cannot reach `framer.website` (environment network policy blocks
the domain at the proxy, archive.org too). Nothing below the checklist has been
verified against the real site yet, and no palette/type values may be invented
from memory of "typical Framer templates".

### How to complete the digest (either works)

1. **Screenshots into chat**: Ross pastes full-page screenshots (desktop +
   mobile, every section) into a Claude session; extract tokens visually.
2. **Unrestricted machine**: on Ross's main machine (or an environment whose
   network policy allows framer.website), load the site and pull computed
   styles. A ready-made Playwright extraction script exists from the first
   attempt; it captures screenshots plus top colors, fonts, radii, shadows,
   weights, headings and buttons.

### What to capture

- [ ] Full-page screenshots, desktop 1440w and mobile 390w
- [ ] Background + text palette (exact rgb/hex, incl. section alternations)
- [ ] Accent color(s) and where they're allowed to appear
- [ ] Font families (headings vs body), the full type scale with weights and
      letter-spacing, any serif/display accents
- [ ] Border radius scale, border colors/widths, shadow recipes
- [ ] Button anatomy: fill, border, radius, padding, hover/transition
- [ ] Card anatomy and the bento/feature grid layout
- [ ] Nav bar: height, blur/transparency, link treatment, CTA placement
- [ ] Hero: layout, headline size/structure, subcopy tone, mockup treatment
- [ ] Section order of the whole page + what each section contains
- [ ] Copywriting voice (short/punchy vs explanatory; sentence case vs title case)
- [ ] Gradients, glows, noise/texture, illustration or screenshot style
- [ ] Pricing card layout (we have 3 tiers: $5/$10/$20)
- [ ] Footer structure

### Once captured

Fill this file with the tokens, then restyle `apps/web` to match (index.css
design tokens first, then component pass), and mirror the aesthetic in the
future marketing site. Keep the copy rule: no em dashes in user-facing text.
