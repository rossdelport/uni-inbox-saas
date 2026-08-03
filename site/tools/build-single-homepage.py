#!/usr/bin/env python3
"""Convert site/index.html into a single self-contained HTML file (no Framer runtime).

One-shot conversion, applied 2026-08-04 and kept for reference / for converting
the remaining Framer pages the same way. It expects the PRE-conversion
index.html (the Framer-runtime version, last at git tag/commit before the
conversion); running it against the converted file fails its assertions on
purpose. inputs/ holds the two DOM captures taken from the hydrated page:
the mobile-opened nav variant and the four carousel cards.

Every transform asserts it matched exactly what it expected, so a drifted
source file fails loudly instead of silently producing a broken page.

What the Framer runtime did on this page, and what replaces it:
  - hydration (reverted hand-edits)          -> gone; edits stick
  - nav/hero appear animation                -> inline animator (already in the HTML)
  - per-section scroll-in reveal             -> IntersectionObserver + WAAPI (uni runtime)
  - testimonials ticker marquee              -> WAAPI marquee at the measured 40px/s
  - mobile testimonials carousel             -> scroll-snap track + dots (hydrated card DOM)
  - mobile hamburger menu                    -> captured mobile-opened variant + toggle
  - envelope resting positions               -> offsets cleared in the markup
"""
import json
import os
import re

TOOLS = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(TOOLS)
INPUTS = os.path.join(TOOLS, 'inputs')

html = open(f'{SITE}/index.html').read()
orig_len = len(html)

def sub_once(pattern, repl, text, label, count=1, regex=False):
    if regex:
        new, n = re.subn(pattern, repl, text)
    else:
        n = text.count(pattern)
        new = text.replace(pattern, repl)
    assert n == count, f'{label}: expected {count} matches, got {n}'
    print(f'  ok: {label} ({n})')
    return new

# ---- 1. drop the Framer runtime ----------------------------------------
html = sub_once(r'<link fetchpriority="low" href="/assets/framer/[^"]+\.mjs" rel="modulepreload"/>\s*', '', html,
                'modulepreload links', count=15, regex=True)
html = sub_once('<meta content="assets/framer/searchIndex-O8ff0wgWSOH-.json" name="framer-search-index"/>\n', '', html,
                'search-index meta')
html = sub_once('<script async="" data-framer-bundle="main" fetchpriority="low" src="/assets/framer/script_main.6VKQAPUF.mjs" type="module"></script>', '', html,
                'script_main tag')

# ---- 2. inline landing-positioning.css ----------------------------------
lp_css = open(f'{SITE}/assets/landing-positioning.css').read()
assert '</style' not in lp_css
html = sub_once('<link rel="stylesheet" href="/assets/landing-positioning.css?v=pill-1">',
                '<style id="uni-landing-positioning">\n' + lp_css + '\n</style>', html,
                'inline landing-positioning.css')

# ---- 3. patch the big inline patcher ------------------------------------
old_mails = """(function(){
  function live(){ document.documentElement.classList.add('uni-mails-live'); }
  var ssr = document.querySelector('[data-framer-name="mails"]');
  if (!ssr){ live(); return; }
  var mo = new MutationObserver(function(){
    if (!document.contains(ssr)){ mo.disconnect(); requestAnimationFrame(live); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  // Safety: never leave them hidden (no-hydration / slow network).
  setTimeout(function(){ mo.disconnect(); live(); }, 2500);
})();"""
new_mails = """(function(){
  // This gate used to hide the SSR envelopes until Framer hydration swapped
  // in its live copy. There is no runtime on this page anymore: the SSR
  // envelopes ARE the page, so they go live immediately.
  document.documentElement.classList.add('uni-mails-live');
})();"""
html = sub_once(old_mails, new_mails, html, 'mails reveal gate')

old_meas = """    var gw = gmailTag.getBoundingClientRect().width;
    var mw = tag.getBoundingClientRect().width;
    if (!(mL > gL) || isNaN(gL) || isNaN(mL)) return;"""
new_meas = """    var gw = gmailTag.getBoundingClientRect().width;
    var mw = tag.getBoundingClientRect().width;
    // Hidden breakpoint variants stay in the DOM now (nothing culls them)
    // and measure 0 wide, which would bake in garbage positions. Skip; the
    // resize re-run patches a variant once its breakpoint shows it.
    if (gw < 1 || mw < 1) return;
    if (!(mL > gL) || isNaN(gL) || isNaN(mL)) return;"""
html = sub_once(old_meas, new_meas, html, 'patchTabs hidden-variant guard')

# ---- 4. envelopes at their resting spots --------------------------------
# SSR ships the hero envelopes with appear-offset transforms whose appear
# JSON entries were deliberately nulled; hydration was what reset them.
html = sub_once(r'(style="opacity:1;will-change:transform;transform:)translate[^";]*(?=")',
                r'\g<1>none', html, 'envelope resting transforms', count=6, regex=True)

# ---- 5. mobile testimonials carousel ------------------------------------
# SSR ships one hidden card and no controls; the runtime built the carousel.
# Rebuild it as a scroll-snap track using the hydrated cards (all classes
# they use ship in this page's stylesheet).
cards = open(f'{INPUTS}/carousel-cards.html').read()
slides = '\n'.join(f'<li style="display:contents">{c}</li>' for c in cards.split('\n<div class="uni-car-slide">')[:1]) # placeholder, rebuilt below
card_list = re.findall(r'<div class="uni-car-slide">.*?(?=\n<div class="uni-car-slide">|\Z)', cards, re.S)
assert len(card_list) == 4, f'expected 4 cards, got {len(card_list)}'
assert all(len(c) > 3000 for c in card_list), f'malformed card split: {[len(c) for c in card_list]}'
slides = '\n'.join(f'<li style="display:contents">{c.strip()}</li>' for c in card_list)

# The SSR markup already carries the dots pill (fieldset.framer--slideshow-controls
# right after the ul), so only the track itself is replaced; the runtime JS wires
# the existing dot buttons up.
TRACK_UL = ('<ul class="uni-car-track" style="display:flex;flex-direction:row;width:calc(100% + 90px);height:100%;'
            'margin:0 0 0 -45px;padding:0 45px;list-style-type:none;gap:16px;place-items:center;'
            'overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;'
            'scrollbar-width:none">' + slides + '</ul>')

slot_pat = re.compile(
    r'(<div class="framer-c1vmkt-container hidden-72rtr7 hidden-l3u4ek">\s*'
    r'<section style="[^"]*?)opacity:0\.001;([^"]*">\s*'
    r'<div style="[^"]*">)\s*'
    r'<ul style="[^"]*">.*?</ul>', re.S)
matches = slot_pat.findall(html)
assert len(matches) == 2, f'carousel slots: expected 2, got {len(matches)}'
html = slot_pat.sub(lambda m: m.group(1) + 'opacity:1;' + m.group(2) + TRACK_UL, html)
print('  ok: mobile carousel slots (2)')

# ---- 5a. restore inter-span spaces the export minifier ate ---------------
# The SSR markup drops the whitespace between styled spans in the providers
# heading ("Workswith all youremail providers"); hydration used to re-render
# it with the spaces back. Bake them in.
html = sub_once('Works<span class="framer-text"', 'Works <span class="framer-text"', html,
                'heading space after Works', count=2)
html = sub_once('</span>email providers', '</span> email providers', html,
                'heading space before email', count=2)
html = sub_once('">Works</span>with all your', '">Works</span> with all your', html,
                'mobile heading space after Works')

# ---- 5b. reveal the ticker rows ------------------------------------------
# Each ticker row's wrapper section ships opacity:0; the runtime revealed it
# when the marquee started. The static marquee starts at load, so bake it in.
html = sub_once('text-indent:none;opacity:0;overflow:visible',
                'text-indent:none;opacity:1;overflow:visible', html,
                'ticker section reveal', count=4)

# ---- 6. the uni static runtime (hamburger, reveals, marquee, carousel) --
open_html = open(f'{INPUTS}/menu-open.html').read()
open_html = sub_once('href="./solutions"', 'href="/solutions/"', open_html, 'menu href solutions')
open_html = sub_once('href="./pricing"', 'href="/pricing/"', open_html, 'menu href pricing')
open_html = sub_once('href="./contacts"', 'href="/contacts/"', open_html, 'menu href contacts')
open_html = sub_once('href="./" target="_blank" data-framer-page-link-current="true"',
                     'href="/app/signup"', open_html, 'menu Start Today href')
open_html = sub_once('href="./"', 'href="/"', open_html, 'menu href home', count=2)
assert '<script' not in open_html.lower()
open_js_literal = json.dumps(open_html).replace('</', '<\\/')

runtime_js = r"""<script>
/* ==== OneInbox static runtime ====
   Stand-ins for the behaviors the Framer runtime used to provide. */
(function(){
"use strict";
var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- scroll-in section reveals ----------
   Seven sections ship with inline opacity:0 + translateY(150px); the runtime
   revealed each one (once) as it entered the viewport. Same spring feel as
   the hero appear. */
(function(){
  var els = Array.prototype.filter.call(document.querySelectorAll('section[data-framer-name]'), function(s){
    var st = s.getAttribute('style') || '';
    return st.indexOf('opacity:0;transform:translateY(150px)') !== -1;
  });
  function reveal(s){
    var animate = !REDUCED && s.animate && s.getBoundingClientRect().width > 0;
    s.style.opacity = '1';
    s.style.transform = 'none';
    if (animate){
      s.animate([{ opacity: 0, transform: 'translateY(150px)' }, { opacity: 1, transform: 'none' }],
                { duration: 1100, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
  }
  if (REDUCED || !('IntersectionObserver' in window)){ els.forEach(reveal); return; }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if (en.isIntersecting){ io.unobserve(en.target); reveal(en.target); }
    });
  });
  els.forEach(function(s){ io.observe(s); });
})();

/* With reduced motion the inline appear animator never runs, and hydration
   is no longer around to show the nav and hero afterwards: clear their
   appear-initial styles outright. */
if (REDUCED){
  Array.prototype.forEach.call(document.querySelectorAll('[data-framer-appear-id]'), function(el){
    if ((el.style.opacity || '') !== '' || el.style.transform){ el.style.opacity = '1'; el.style.transform = 'none'; }
  });
}

/* ---------- testimonials ticker marquee ----------
   The runtime cloned each row to 12 items and slid it at 40px/s, first row
   leftward, second rightward. Reproduce exactly; loop over one clone-set
   width so the wrap is seamless. */
function initMarquees(){
  if (REDUCED) return;
  Array.prototype.forEach.call(document.querySelectorAll('[data-framer-name="tickers"]'), function(t){
    Array.prototype.forEach.call(t.querySelectorAll('ul'), function(ul, row){
      if (ul.__uniMarquee) return;
      var r = ul.getBoundingClientRect();
      if (r.width < 60) return; // hidden breakpoint variant; resize retries
      var orig = Array.prototype.slice.call(ul.children);
      if (!orig.length || !ul.animate) return;
      var first = orig[0].getBoundingClientRect(), last = orig[orig.length - 1].getBoundingClientRect();
      var gap = parseFloat(getComputedStyle(ul).columnGap || getComputedStyle(ul).gap) || 20;
      var groupW = last.right - first.left + gap;
      if (groupW < 100) return;
      ul.__uniMarquee = true;
      var copies = Math.max(2, Math.ceil((innerWidth + groupW) / groupW));
      for (var k = 0; k < copies; k++){
        orig.forEach(function(li){ ul.appendChild(li.cloneNode(true)); });
      }
      var kf = row % 2 === 0
        ? [{ transform: 'translateX(0)' }, { transform: 'translateX(' + (-groupW) + 'px)' }]
        : [{ transform: 'translateX(' + (-groupW) + 'px)' }, { transform: 'translateX(0)' }];
      ul.animate(kf, { duration: groupW / 40 * 1000, iterations: Infinity, easing: 'linear' });
    });
  });
}
initMarquees();
window.addEventListener('resize', function(){ setTimeout(initMarquees, 200); });

/* ---------- mobile testimonials carousel dots ----------
   The dots pill ships in the SSR markup (fieldset.framer--slideshow-controls
   next to the track); wire its buttons to the scroll-snap track. */
Array.prototype.forEach.call(document.querySelectorAll('.uni-car-track'), function(track){
  var scope = track.closest('section') || track.parentElement;
  var buttons = scope ? scope.querySelectorAll('fieldset button[aria-label^="Scroll to page"]') : [];
  var slides = track.querySelectorAll('.uni-car-slide');
  function setActive(i){
    Array.prototype.forEach.call(buttons, function(b, k){
      var d = b.querySelector('div');
      if (d) d.style.opacity = k === i ? '1' : '0.5';
    });
  }
  track.addEventListener('scroll', function(){
    clearTimeout(track.__uniT);
    track.__uniT = setTimeout(function(){
      var center = track.scrollLeft + track.clientWidth / 2, best = 0, bd = 1e9;
      Array.prototype.forEach.call(slides, function(s, k){
        var c = s.offsetLeft + s.offsetWidth / 2, d = Math.abs(c - center);
        if (d < bd){ bd = d; best = k; }
      });
      setActive(best);
    }, 80);
  }, { passive: true });
  Array.prototype.forEach.call(buttons, function(btn, i){
    btn.addEventListener('click', function(){
      var s = slides[i];
      if (s) track.scrollTo({ left: s.offsetLeft + s.offsetWidth / 2 - track.clientWidth / 2, behavior: REDUCED ? 'auto' : 'smooth' });
    });
  });
});

/* ---------- hamburger menu ----------
   The runtime swapped the mobile nav between its mobile-closed and
   mobile-opened variants; do the same swap with the runtime's own
   mobile-opened DOM (captured once from the hydrated page; every class it
   uses ships in this page's stylesheet), plus a height tween standing in
   for the variant spring. */
var OPEN_HTML = __OPEN_HTML__;
var closedHTML = null;
var animating = false;
function mobileNav(){
  return document.querySelector('nav[data-framer-name="mobile-closed"], nav[data-framer-name="mobile-opened"]');
}
function menuIsOpen(){
  var nav = mobileNav();
  return !!nav && nav.getAttribute('data-framer-name') === 'mobile-opened';
}
function swapNav(markup){
  var nav = mobileNav();
  if (!nav) return null;
  nav.outerHTML = markup;
  return mobileNav();
}
function tween(card, fromH, toH, links, dirIn, done){
  if (REDUCED || !card || !card.animate || Math.abs(toH - fromH) < 2){ done(); return; }
  animating = true;
  card.style.overflow = 'hidden';
  var a = card.animate([{ height: fromH + 'px' }, { height: toH + 'px' }],
                       { duration: 300, easing: 'cubic-bezier(0.3, 0.9, 0.3, 1)' });
  Array.prototype.forEach.call(links || [], function(el, i){
    el.animate(dirIn
      ? [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }]
      : [{ opacity: 1 }, { opacity: 0 }],
      { duration: dirIn ? 260 : 140, delay: dirIn ? 60 + i * 30 : 0, fill: 'both', easing: 'ease-out' });
  });
  a.onfinish = a.oncancel = function(){
    card.style.overflow = '';
    animating = false;
    done();
  };
}
function setMenuOpen(open, instant){
  if (animating || !closedHTML || open === menuIsOpen()) return;
  var nav = mobileNav();
  if (!nav) return;
  var card = nav.querySelector('.framer-lmshmi');
  var fromH = card ? card.getBoundingClientRect().height : 0;
  if (open){
    nav = swapNav(OPEN_HTML);
    if (!nav) return;
    var openCard = nav.querySelector('.framer-lmshmi');
    if (instant || !openCard) return;
    var links = nav.querySelectorAll('.framer-11tzw6k > div');
    tween(openCard, fromH, openCard.getBoundingClientRect().height, links, true, function(){});
  } else {
    if (instant || !card){ swapNav(closedHTML); return; }
    var closedH = 61;
    var probe = nav.querySelector('.framer-lrfi3e');
    if (probe) closedH = probe.getBoundingClientRect().height;
    tween(card, fromH, closedH, nav.querySelectorAll('.framer-11tzw6k > div'), false, function(){ swapNav(closedHTML); });
  }
}
var nav0 = mobileNav();
if (nav0) closedHTML = nav0.outerHTML;
document.addEventListener('click', function(e){
  var burger = e.target && e.target.closest ? e.target.closest('.framer-3qve3t') : null;
  if (!burger || !burger.closest('nav')) return;
  e.preventDefault();
  setMenuOpen(!menuIsOpen());
});
document.addEventListener('keydown', function(e){
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var burger = e.target && e.target.closest ? e.target.closest('.framer-3qve3t') : null;
  if (!burger) return;
  e.preventDefault();
  setMenuOpen(!menuIsOpen());
});
window.addEventListener('resize', function(){
  if (window.innerWidth > 833 && menuIsOpen()) setMenuOpen(false, true);
});
})();
</script>"""
runtime_js = runtime_js.replace('__OPEN_HTML__', open_js_literal)

STATIC_CSS = """<style id="uni-static">
/* scroll-snap track for the mobile testimonials carousel */
.uni-car-track::-webkit-scrollbar{display:none}
.uni-car-slide{flex:0 0 301px;scroll-snap-align:center;height:100%;display:flex;align-items:center}
</style>"""

# ---- 7. inline landing-positioning.js (run now, not after hydration) ----
lp_js = open(f'{SITE}/assets/landing-positioning.js').read()
old_tail = """  // Framer hydrates the exported page after these scripts are parsed. A
  // permanent DOM observer can race React's reconciliation and cause a
  // removeChild error, so use a few delayed passes instead. The page is then
  // left alone; the only ongoing behavior is the explicit pricing controls.
  schedule(900);
  setTimeout(function () { wrapSlider(); applyAll(); }, 1800);
  setTimeout(function () { wrapSlider(); applyAll(); }, 3200);
  window.addEventListener("resize", function () { schedule(240); });
})();"""
new_tail = """  // No Framer runtime on this page anymore, so the DOM is stable from parse
  // time: apply once now, one settle pass for anything the structural
  // patchers above finish late, and re-apply on resize for the layout math.
  wrapSlider(); applyAll();
  schedule(300);
  window.addEventListener("resize", function () { schedule(240); });
})();"""
lp_js = sub_once(old_tail, new_tail, lp_js, 'landing-positioning tail')
assert '</script' not in lp_js.lower()

# ---- 8. inline footer-links.js (links are baked in; keep as safety net) --
fl_js = open(f'{SITE}/assets/footer-links.js').read()
old_fl_tail = """  setTimeout(ensureTerms, 900);
  setTimeout(ensureTerms, 1800);
  setTimeout(ensureTerms, 3200);
  setTimeout(ensureTerms, 6000);
})();"""
new_fl_tail = """  ensureTerms();
  setTimeout(ensureTerms, 1000);
})();"""
fl_js = sub_once(old_fl_tail, new_fl_tail, fl_js, 'footer-links tail')
old_fl_head = """// Footer legal links, restored after Framer hydration.
//
// The exported HTML was hand-edited to turn the template's "404" footer item
// into a Terms of Service link, but Framer re-renders the footer from its
// bundled template data on hydration, so the edit vanishes a moment after
// load. Hydration also rewrites hrefs to relative ("./privacy-policy",
// "./404"), so match loosely rather than on exact paths. Repurposing the
// resurrected 404 item in place sticks across React's reconciliation the same
// way landing-positioning.js's copy patches do; inserting new nodes does not."""
new_fl_head = """// Footer legal links safety net. Privacy Policy and Terms of Service are
// baked into the footer markup itself (nothing re-renders it away anymore);
// this only repairs the Terms link if a future edit drops it."""
fl_js = sub_once(old_fl_head, new_fl_head, fl_js, 'footer-links head comment')
assert '</script' not in fl_js.lower()

# ---- 9. swap the external script tags for the inline versions -----------
html = sub_once('<script src="/assets/landing-positioning.js?v=owner-operator-v6"></script>',
                STATIC_CSS + '\n' + runtime_js + '\n<script>\n' + lp_js + '\n</script>', html,
                'inline landing-positioning.js + static runtime')
html = sub_once('<script src="/assets/footer-links.js?v=2"></script>',
                '<script>\n' + fl_js + '\n</script>', html,
                'inline footer-links.js')

# ---- final sanity --------------------------------------------------------
leftover = re.findall(r'assets/framer/[^"\']*', html)
assert not leftover, f'framer refs remain: {leftover[:5]}'
assert 'script_main' not in html
assert html.count('uni-car-track') >= 3  # 2 slots + css/js references
assert html.count('Terms of Service') >= 3

open(f'{SITE}/index.html', 'w').write(html)
print(f'\nwrote {SITE}/index.html: {orig_len} -> {len(html)} bytes')
