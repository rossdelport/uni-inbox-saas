# Design north star: the Maily Framer site

**URL: https://maily-template.framer.website/**

Ross's call (2026-07-23): this is the exact UI/UX Uni-Inbox will have, for the
marketing site and, in spirit, the dashboard. Treat it as the reference for
every visual decision. (It is published from the Maily Framer template; if we
reuse its actual assets/layout for the marketing site rather than just the
aesthetic, make sure the template license is on Ross's Framer account.)

## Status: digest PENDING — do not guess

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
