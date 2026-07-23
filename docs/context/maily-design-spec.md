# Maily — Design Specification

> Design system + page spec for the **Maily** SaaS landing site (originally built in Framer).
> Use this document to rebuild the site 1:1 in code (any stack: plain HTML/CSS, React, Next.js, Tailwind, etc.).

---

## 1. Product Overview

**Maily** is a (fictional) AI-powered email client SaaS. The site is a marketing landing site with a playful, friendly, rounded aesthetic — soft blues, pill shapes, floating envelope illustrations, and chunky rounded typography.

**Pages (6 routes):**

| Route | Purpose |
|---|---|
| `/` | Home — hero, features, testimonials, FAQ, pricing, CTA, footer |
| `/solutions/` | Use-case pages for Teams / Students / Families + integrations, FAQ, pricing |
| `/pricing/` | Dedicated pricing page (3 tiers) |
| `/contacts/` | Contact form + FAQ + CTA |
| `/privacy-policy/` | Legal text page |
| `/404/` | Not-found page |

**External links used:**
- All CTA buttons ("Start Today", "Get Started", "Get started today", "Buy Template") → `https://skale.lemonsqueezy.com/buy/e815c4e9-cc11-4140-b1a0-047b78cf4535`
- "𝕏 Reach us" → `https://x.com/MarkKnd`
- Socials: `https://x.com/MarkKnd`, `https://www.instagram.com/markvassilevskiy/`, `https://www.linkedin.com/in/markknd/`
- Contact email: `support@maily.io` · Tel: `+1 (414) 455-3046` · Address: `123 Maily Lane, San Francisco, CA, USA`

---

## 2. Design Tokens

### 2.1 Colors

**Brand blues (primary):**

| Token | Value | Usage |
|---|---|---|
| `--blue-primary` | `#0C7DFF` | Primary brand blue, buttons accents, highlights |
| `--blue-secondary` | `#2786FF` | Hero gradient, emphasized UI |
| `--blue-bright` | `#0099FF` | Links / accents |
| `--blue-mid` | `#4A9BF5` | Gradient stops, icons |
| `--blue-glow` | `rgba(10, 114, 237, 0.64)` | Signature inner-glow inset shadow on pills/cards |

**Light blues (backgrounds & illustration tints):**

| Token | Value | Usage |
|---|---|---|
| `--blue-100` | `#E8F0FF` | Section gradient backgrounds |
| `--blue-200` | `#CBE6F6` | Card tints |
| `--blue-300` | `#ABE2FF` | Sky-blue hero gradient end |
| `--blue-400` | `#B5D8FF` (`rgb(181,216,255)`) | Decorative shapes |
| `--blue-ice` | `#B0E0FE` | Illustration fills |

**Neutrals:**

| Token | Value | Usage |
|---|---|---|
| `--white` | `#FFFFFF` | Cards, nav pill, text on blue |
| `--off-white` | `#FBFBF8` (`rgb(251,251,248)`) | Page background sections |
| `--gray-50` | `#F9F9F9` / `#F8F8F8` | Subtle section fills |
| `--gray-100` | `#F5F5F5` / `#F6F6F6` | Card fills |
| `--gray-200` | `#EBEBEB` | Borders/dividers |
| `--gray-300` | `#DDDDDD` / `#D5D5D5` / `#D9D9D9` | Borders, placeholders |
| `--ink` | `#000000` | Headings, primary buttons |
| `--ink-83` | `rgba(0,0,0,0.83)` | Body-strong text |
| `--ink-50` | `rgba(0,0,0,0.50)` | Secondary text |
| `--ink-45` | `rgba(0,0,0,0.45)` | Muted text |
| `--ink-10` | `rgba(0,0,0,0.10)` | Hairline borders |
| `--ink-17` | `rgba(0,0,0,0.17)` | Soft shadow color |
| `--ink-05` | `rgba(0,0,0,0.05)` | Very soft shadow |
| `--charcoal` | `#444343` | Footer/dark text alt |

**Accent tints (tags & badges):**

| Token | Value | Usage |
|---|---|---|
| `--orange` | `#FF7A00` | Accent tag (e.g. "Work") |
| `--mint` | `#D0F6EA` | Tag background (green) |
| `--blue-tag` | `#CBE0F0` | Tag background (blue) |

### 2.2 Typography

**Font stack (load via Google Fonts):**

| Font | Role | Weights |
|---|---|---|
| **M PLUS Rounded 1c** | Display / headings / logo — the signature chunky rounded face | 400, 500, 700, 800 |
| **M PLUS 1** | UI labels, buttons, nav | 400, 500, 600, 700 |
| **Inter** | Body text, paragraphs, small print | 400, 500, 600 |
| Montserrat | Minor accents | 400–600 |
| Roboto Mono | Tiny labels / code-ish tags | 400 |

**Type scale (desktop):**

| Style | Size | Weight | Font |
|---|---|---|---|
| Hero display | 56px | 800 | M PLUS Rounded 1c |
| Page title | 48px | 700–800 | M PLUS Rounded 1c |
| Section heading | 42–46px | 700 | M PLUS Rounded 1c |
| Sub-heading | 32–36px | 700 | M PLUS Rounded 1c |
| Card title | 24–28px | 700 | M PLUS Rounded 1c |
| Large body / price | 20–26px | 500–700 | M PLUS 1 / Rounded |
| Body | 16–18px | 400–500 | Inter |
| Small / caption | 15–17px | 400–500 | Inter |
| Nav links | 15–16px | 500 | M PLUS 1 |

Inline emphasis inside headings uses color spans (e.g. blue `#0C7DFF` words inside white/black headings).

### 2.3 Radii

| Token | Value | Usage |
|---|---|---|
| `--radius-pill` | `999px` (Framer uses 50/100px fixed) | Buttons, nav bar, badges, tags |
| `--radius-card-lg` | `40px` | Feature/pricing cards, big panels |
| `--radius-card-xl` | `48px` | Hero panel, CTA banner |
| `--radius-card-md` | `50px` on illustration cards | Rounded screenshot/mock cards |

### 2.4 Shadows

The site's **signature look** comes from layered soft shadows + a blue inner glow:

```css
/* Signature inset blue glow — used on white pills, nav, tags, cards */
--shadow-glow: inset 0px -1px 1px 0px rgba(10, 114, 237, 0.64);

/* Soft elevated card */
--shadow-card:
  0px 1px 1px 0px rgba(0,0,0,0.10),
  0px 2px 2px 0px rgba(0,0,0,0.09),
  0px 4.5px 2.5px 0px rgba(0,0,0,0.05);

/* Floating illustration / big lift */
--shadow-float:
  0px 5px 10px 0px rgba(0,0,0,0.10),
  0px 20px 15px 0px rgba(0,0,0,0.17);

/* White pill button */
--shadow-pill:
  0px 2px 0px 0px rgba(183,183,183,1),
  inset 0px 5px 14px 0px rgba(255,255,255,0.5);

/* Dark pill button — dark gradient + inner white top highlight + blue bottom glow */
--shadow-pill-dark:
  inset 0px 2.4px 4.9px 0px rgba(255,255,255,1),
  inset 0px -1.2px 2.9px 0px rgba(0,102,255,0.39);
```

### 2.5 Gradients

```css
/* Hero sky — big rounded panel */
background: linear-gradient(180deg, #2786FF 0%, #ABE2FF 100%);

/* Section fade (white → light blue) */
background: linear-gradient(180deg, #FFFFFF 0%, #E8F0FF 100%);

/* Card sheen */
background: linear-gradient(180deg, rgba(255,255,255,1), rgba(255,255,255,0.5));

/* Dark pill button */
background: linear-gradient(182deg, #3C3C3C 0%, #000000 100%);
```

### 2.6 Breakpoints

| Name | Width |
|---|---|
| Desktop | ≥ 1200px |
| Tablet | 834px – 1199px |
| Mobile | ≤ 833px (small tweaks at 810px) |

Layout collapses to a single centered column on mobile; nav collapses to a hamburger overlay menu.

---

## 3. Global Layout & Components

### 3.1 Fixed Navigation Bar

- Centered **white pill**, `border-radius: 999px`, floating with `--shadow-glow` + soft drop shadow, `position: fixed`, top ~24px, max-width ~700px.
- Left: app icon (rounded-square blue/black gradient logo mark).
- Links (M PLUS 1, 15px, `#444343`): **Home · Solutions · Pricing · Contacts**. Active page link is black/bold.
- Right: **Start Today** button — dark pill (see 3.2), links to Lemon Squeezy checkout.
- Mobile: hamburger icon opens full-screen white overlay menu with the same links stacked.

### 3.2 Buttons

**Primary (dark pill):** black→charcoal vertical gradient, white text (M PLUS 1, 600), radius 999px, `--shadow-pill-dark`, padding ~14px 28px. Text: "Get Started" / "Start Today" / "Get started today".

**Secondary (white pill):** white bg, black text, radius 999px, `--shadow-pill`, hairline border. Used for "𝕏 Reach us" (includes the 𝕏 glyph).

Both scale slightly / deepen shadow on hover.

### 3.3 Social-proof Badge Pill

White pill: 3 overlapping circular avatar images + text "**6,000+ people use our product**" (Inter, 15px, `--ink-50`). `--shadow-glow` inset.

### 3.4 Cards

- Large feature/pricing cards: white or `--gray-100` bg, `border-radius: 40px`, hairline `rgba(0,0,0,0.05)` border, `--shadow-card`.
- Inner mock-UI cards (notification previews, bill rows): white, radius ~24–32px, `--shadow-float` for the floating ones.
- Blue inner-glow accent (`--shadow-glow`) appears on interactive/featured elements.

### 3.5 Tags (AI-TAGS row)

Small pills (radius 999px) with emoji + label: `🧑‍💻 IT-Team`, `👨‍🎨 Design`, `Family`, `Work` (`--orange` accent), and a dark "**AI-TAGS**" pill. Mixed tint backgrounds (`--mint`, `--blue-tag`, white).

### 3.6 FAQ Accordion

Left: big heading "**Frequently asked questions**" + subtext "Got questions? We've got the answers to help you get started smoothly."
Right: accordion items — "How does this work?", "Is it easy to learn?", "Do I need to code?", "Can I customize the tags?" — each a white card row with a `+` icon that expands.

### 3.7 Pricing Cards (shared component, used on Home + Solutions + Pricing)

Three cards side-by-side (stack on mobile), white, radius 40px, `--shadow-card`. Middle card is elevated with "**Users choice**" ribbon badge (blue medal/rosette icon + pill).

| | **Basic** | **Premium** ⭐ | **Business** |
|---|---|---|---|
| Price | **$0**/month | **$30**/month | **$100**/month |
| Tagline | All the email basics in one package. | Designed to scale with you. | Everything you need to grow your business. |
| CTA | Get started today (dark pill) | Get started today (dark pill) | Get started today (dark pill) |
| Features | Unlimited mails · 2 Team members · 30 AI credits per month · Scheduling · Privacy reports | Everything in basic · 1.000 AI credits per month · 5 Team members · AI task management · AI summarize | Everything in Premium · Unlimited team members · 3,000 AI credits per user · Team channel · Tool support |

Feature rows use a blue circular check badge icon. Price in M PLUS Rounded 1c, ~48px, with `/month` in `--ink-45`.

### 3.8 Testimonial Cards (Home)

4 white rounded cards in a 2×2 grid (stack on mobile). Each: quote paragraph (Inter, 17px, `--ink-83`), then reviewer name in bold + avatar. Copy:

1. "I can't imagine running my day without it. The notifications are instant, and the categorization makes life much easier. A game-changer for staying organized!" — **Samantha Collins**
2. "The best productivity tool I've used. It keeps my team on track and ensures I never miss an important message. Simple yet powerful" — **David Nguyen**
3. "Finally, a solution that feels intuitive and just works. I love the AI-tagging system—it keeps everything in order with zero effort from me" — **Emily Johnson**
4. "This app has completely transformed how I manage my emails. The real-time notifications and seamless organization save me so much time every day" — **Michael Reed**

### 3.9 CTA Banner

Big rounded (48px) blue-gradient panel: heading "**The Best Email Ever Made**" (white, M PLUS Rounded 1c), subtext "Discover how Maily helps teams, businesses, and individuals stay organized, productive, and stress-free", and a white-pill button "**Try it first**".

### 3.10 Footer

Off-white (`--off-white`) background, top hairline divider. Columns:
- **Brand:** Maily logo + "Maily.io" + tagline "Secure funding for your startup from over 5,000 investors, making the process seamless and efficient."
- **Legal:** Privacy Policy, 404
- **Menu:** Home, Solutions, Pricing, Contacts
- **Social Media:** X, Instagram, LinkedIn (links in §1)

Small Inter text, `--ink-50`; headings in M PLUS 1, 600.

---

## 4. Page Specs

### 4.1 Home `/`

1. **Hero** — full-width sky-blue gradient panel (`#2786FF → #ABE2FF`) with huge bottom border-radius (~48px) and **floating white 3D envelope illustrations** drifting/rotating at various sizes/depths (subtle continuous float animation). Content centered:
   - Badge pill: "6,000+ people use our product" (3 avatars)
   - H1 (white, 56px, M PLUS Rounded 1c): **"The best email, ever made."**
   - Sub (white 87% opacity, Inter 18px): "Get **real-time notifications** with our email app, ensuring you never miss an **important message**." (bold phrases highlighted)
   - Buttons: dark pill "**Get Started**" + white pill "**𝕏 Reach us**"
2. **Features** — "Features you will love." + "Manage emails for over 5,000 startups all over the world, making the process seamless and efficient". Feature cards with inline highlighted phrases:
   - Security: "We ensure every message stays **secure with advanced encryption**, giving you full control over who sees what and when."
   - Notifications: "Never miss an **important message**. Get notified instantly, ensuring **you're always in the loop** and ready."
   - Smart search: "Identify errors with **smart notifications and search tools**, helping you stay organized and solve problems **quickly**"
   - **AI-TAGS** block: "Categorization? **Done for you!**" with the tag pills row (🧑‍💻 IT-Team, 👨‍🎨 Design, Family, Work).
   - Feature grid chips: Custom Inboxes, Read Checker, Scheduling, Book Meetings, Team Support, AI Writer, Advanced Spam Detection, "And so much more…"
3. **Notification mock cards** — two floating UI cards (visual demos):
   - "Google Inc. — **Add User to Workspace** — New user has been added to your workspace. You can now collaborate seamlessly within your Google Workspace account."
   - "Slack — **You've Been Mentioned** — Someone in #general just mentioned you! Tap here to check the message and stay in the loop with your team."
4. **Testimonials** — id `#testimonials`. Eyebrow "Testimonials", heading "Why **people** love Maily." + 4 cards (§3.8).
5. **Integrations strip** — "**Works with your favorite tools...**" + logo marquee (Facebook, Google, Twitter/X, Instagram, Slack, etc.).
6. **FAQ** (§3.6).
7. **Pricing** (§3.7).
8. **CTA banner** (§3.9).
9. **Footer** (§3.10).

### 4.2 Solutions `/solutions/`

1. Hero: "**One Inbox, Endless Possibilities**" + same subtext and button pair as Home.
2. "**Solutions for who?**" — three audience sections, each with mock UI cards:
   - **Teams** — "Stay connected with your team without losing track of important emails" (calendar-ish cards: "New Meeting", "Demo", "Launch Day").
   - **Students** — (school/updates cards).
   - **Families** — "From school updates to monthly bills, Maily keeps your family's inbox neat and stress-free" — bill list mock: Electricity bill "Bill no. 142, due on 12-1-2025…", Credit Card Statement "Bill no. 23, due on 25-1-2025…", Dinner Bill "Bill no. 45, due on 22-1-2025…" plus Shopping / Updates rows ("School dance club", "Dinner arrangements", "New Year party", "Car Service"), Transactions card with Facebook / Google / Twitter / Instagram rows.
3. Integrations strip, FAQ, Pricing, CTA, Footer (same components as Home).

### 4.3 Pricing `/pricing/`

Centered eyebrow pill "Pricing", H1 "**Simple pricing**", subtext "Get everything you need to manage emails efficiently and collaborate with your team", then the 3 pricing cards (§3.7) on a white→light-blue gradient background. Footer.

### 4.4 Contacts `/contacts/`

1. Eyebrow "Our Contacts", H1 "**Got a question? Drop us a message**", subtext "Have a question or need assistance? Our team is here to help you every step of the way."
2. **Contact form card** (white, radius 40px): name / email / message fields with pill-shaped inputs (hairline border, `--gray-50` fill), dark-pill "**Submit**" button; plus "𝕏 Reach us" and "Buy Template" buttons.
3. FAQ, CTA banner, Footer.

### 4.5 Privacy Policy `/privacy-policy/`

Centered narrow column (~720px), eyebrow "Privacy Policy", H1 "Our Privacy Policy", intro "By using Maily, you agree to the collection and use of information in accordance with this Privacy Policy." + "Last updated: 1 Jan 2025". Sections (H2 + Inter body, `--ink-50`): Information We Collect · How We Use Your Information · Data Sharing and Disclosure · Data Retention · Your Data Protection Rights (contact: support@maily.io) · Changes to This Privacy Policy · Contact Us (Email / Tel: +1 (414) 455-3046 / Address: 123 Maily Lane, San Francisco, CA, USA). Then CTA banner + Footer.

### 4.6 404 `/404/`

Centered big "404" in M PLUS Rounded 1c on the light background, with a link back Home. Same nav/footer shell.

---

## 5. Motion & Interaction

- **Hero envelopes:** slow continuous float/rotate (6–10s ease-in-out loops, offset phases), slight parallax on scroll.
- **Scroll reveals:** sections fade/slide up (~24px) on enter, staggered children.
- **Buttons:** hover → subtle scale (1.02–1.04) + deeper shadow; 150–250ms ease.
- **Logo marquee:** infinite horizontal scroll, pauses on hover.
- **FAQ accordion:** height-auto expand/collapse, `+` rotates to `×`.
- **Nav:** stays fixed; gains stronger shadow after scrolling past hero.
- Easing everywhere: `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint feel).

---

## 6. Assets

- **Logo mark:** rounded-square icon, black→blue gradient with a white/blue inbox glyph (also used as favicon).
- **Hero envelopes:** white 3D envelope illustrations with soft shadows (PNG w/ transparency); ~5 instances at different scales/rotations/blur depths.
- **Avatars:** 3 small circular face photos (badge pill) + 4 testimonial portraits.
- **Integration logos:** Facebook, Google, Twitter/X, Instagram, Slack, etc. (grayscale or brand-color, ~28px height).
- **"Users choice" ribbon:** blue rosette/medal icon.
- Original assets were hosted on `framerusercontent.com` — re-export from Framer or replace with equivalents.

---

## 7. Implementation Notes for Claude Code

- Build as 6 static routes; a shared layout (nav + footer) and shared components (Button, PricingCards, FAQ, CTABanner, TestimonialCard, BadgePill, Tag) cover ~80% of the site.
- If using Tailwind: map §2 tokens into `theme.extend` (colors, borderRadius, boxShadow, fontFamily) and keep the type scale as component classes.
- Font loading: `M PLUS Rounded 1c` (400/500/700/800), `M PLUS 1` (400/500/600/700), `Inter` (400/500/600) via Google Fonts.
- Keep the signature details: pill nav with blue inset glow, 40–48px card radii, white→blue section gradients, and the chunky rounded headings — these define the Maily look.
- All purchase CTAs point to the Lemon Squeezy checkout URL in §1.
