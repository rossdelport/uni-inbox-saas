(function () {
  "use strict";

  if (window.__oneInboxPositioningRefresh) return;
  window.__oneInboxPositioningRefresh = true;

  var isWaitlist = Boolean(window.__uniWaitlistPage);
  var COPY_VERSION = "owner-operator-v6";

  var TESTIMONIALS = [
    {
      quote: "I run three businesses and used to check seven inboxes before breakfast. One Inbox shows me what needs attention in one view, so I start the day calm.",
      name: "Maya Thompson"
    },
    {
      quote: "I stopped missing leads because I can see which business each message belongs to. I reply from the right account without thinking about it.",
      name: "Daniel Brooks"
    },
    {
      quote: "Every new business used to mean another tab and another password. Now I see replies and follow-ups together and get back to running the work.",
      name: "Priya Shah"
    },
    {
      quote: "One Inbox gives me control without moving my email or changing providers. I save hours every week and know nothing important is hiding.",
      name: "Chris Morgan"
    }
  ];

  var TESTIMONIAL_AVATARS = [
    "/assets/testimonials/maya-thompson.png",
    "/assets/testimonials/daniel-brooks.png",
    "/assets/testimonials/priya-shah.png",
    "/assets/testimonials/chris-morgan.png"
  ];

  var FAQ_COPY = [
    {
      q: "Which email providers can I connect?",
      a: "Most providers work. Gmail, Outlook, Yahoo, and iCloud connect in a couple of clicks, and any custom mailbox that supports IMAP and SMTP works too, including Porkbun and other domain hosts. Proton Mail, Tuta, and HEY Mail cannot be connected because they block IMAP and SMTP access for third-party apps."
    },
    {
      q: "Is it safe to connect my email accounts?",
      a: "Yes. Your mailbox passwords are encrypted with AES-256-GCM before they are stored, and only our sync engine can read them. Your emails are never sold, shared, or used for advertising."
    },
    {
      q: "Will replies send from the right address?",
      a: "Always. Every reply is sent from the exact address that received the thread, so clients and collaborators never see the wrong from line, no matter how many inboxes you connect."
    },
    {
      q: "How does the free trial work?",
      a: "You get 3 days of full access. You pick your plan and add a card up front, then the trial runs free for 3 days and only converts if you stay. Cancel any time inside those 3 days and you are not charged."
    },
    {
      q: "Does OneInbox replace Gmail or Outlook?",
      a: "No. Keep using your providers. OneInbox connects to your existing accounts and gives you one clear view across every business, while your mail stays exactly where it is."
    },
    {
      q: "Do I move or forward my email?",
      a: "No. Nothing moves and nothing is forwarded. OneInbox syncs your existing mailboxes into one workspace, and every message stays with your provider."
    },
    {
      q: "How many inboxes can I connect?",
      a: "The monthly plan starts at 5 connected accounts and scales up to 10 with the slider. The lifetime plan includes up to 10. You can add or remove accounts whenever you like."
    },
    {
      q: "Can I use OneInbox on my phone?",
      a: "Yes. OneInbox works in any browser on desktop and mobile, and a native iPhone app is on the way."
    }
  ];

  function text(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  // Patch every match, not just the first. The exported page keeps all
  // breakpoint variants in the DOM (hydration used to cull them to one),
  // so each patcher has to visit every copy of its section.
  function each(selector, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), fn);
  }

  function findText(root, matcher) {
    var all = findTexts(root, matcher);
    return all.length ? all[0] : null;
  }

  // All matching nodes, not just the first: every breakpoint variant keeps
  // its own copy of a text node in the DOM now, and each needs the patch.
  function findTexts(root, matcher) {
    var nodes = root ? root.querySelectorAll("h1,h2,h3,h4,p,a,button,span") : [];
    var out = [];
    for (var i = 0; i < nodes.length; i += 1) {
      var value = (nodes[i].textContent || "").replace(/\s+/g, " ").trim();
      if (matcher(value, nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  function setMeta() {
    var title = isWaitlist ? "OneInbox waitlist | Know what needs your attention across every business" : "OneInbox | Know what needs your attention across every business";
    if (document.title !== title) document.title = title;
    var description = "One inbox turns all your email accounts into one clear list of replies, leads and follow-ups for owner-operators running multiple businesses.";
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", description);
    document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach(function (el) {
      el.setAttribute("content", isWaitlist ? "OneInbox waitlist | Know what needs your attention across every business" : "OneInbox | Know what needs your attention across every business");
    });
    document.querySelectorAll('meta[property="og:description"], meta[name="twitter:description"]').forEach(function (el) {
      el.setAttribute("content", description);
    });
  }

  function patchHero() {
    each('section[data-framer-name="hero"]', patchHeroSection);
  }

  function patchHeroSection(hero) {
    // Each breakpoint variant carries its own two-line h1 pair, in order:
    // even indexes are the first line, odd indexes the second.
    hero.querySelectorAll("h1").forEach(function (head, i) {
      text(head, i % 2 === 0 ? "Email for people running" : "multiple businesses");
    });

    findTexts(hero, function (value) {
      return value === "Built for solo founders and indie hackers" || value === "Running multiple businesses?" || value === "Launching soon" || value === "Built for busy solo-operators";
    }).forEach(function (badge) {
      text(badge, isWaitlist ? "Launching soon" : "Built for busy solo-operators");
    });

    findTexts(hero, function (value) {
      return value.indexOf("Connect Gmail") === 0 || value.indexOf("One Inbox turns every email account") === 0 || value.indexOf("One inbox turns all your email accounts") === 0;
    }).forEach(function (subline) {
      text(subline, "Connect your Gmail, Outlook and work email accounts. Then see every reply, lead and follow-up that needs your attention in one clear view.");
    });

    hero.querySelectorAll(".uni-trust span").forEach(function (trust) {
      if (trust.getAttribute("data-copy-version") === COPY_VERSION) return;
      trust.setAttribute("data-copy-version", COPY_VERSION);
      trust.innerHTML = "<b>All your accounts are encrypted.</b> No forwarding. No migration. No switching providers";
    });
  }

  function patchSecurity() {
    each("section[data-uni-sec]", patchSecuritySection);
  }

  function patchSecuritySection(section) {
    var heading = section.querySelector("h2");
    if (heading && heading.getAttribute("data-copy-version") !== COPY_VERSION) {
      heading.setAttribute("data-copy-version", COPY_VERSION);
      heading.innerHTML = "Your business email stays <span>under your control</span>.";
    }
    var lead = section.querySelector(".uni-sec-lead");
    if (lead) text(lead, "Your accounts stay with their providers, and your mail stays protected from sign-in to storage.");

    var cards = section.querySelectorAll(".uni-card");
    var cardCopy = [
      ["Encrypted, private and under your control", "Passwords are protected with <b>AES-256-GCM</b>. Gmail and Microsoft use revocable tokens, every connection uses <b>TLS</b>, and account rules keep each business inbox separate. We never sell your mail, and optional AI features only run when you turn them on."]
    ];
    while (cards.length > 1) {
      cards[cards.length - 1].remove();
      cards = section.querySelectorAll(".uni-card");
    }
    for (var i = 0; i < cards.length && i < cardCopy.length; i += 1) {
      var cardHeading = cards[i].querySelector("h3");
      var cardParagraph = cards[i].querySelector("p");
      if (cardHeading) text(cardHeading, cardCopy[i][0]);
      if (cardParagraph && cardParagraph.innerHTML !== cardCopy[i][1]) cardParagraph.innerHTML = cardCopy[i][1];
    }

    var note = section.querySelector(".uni-note");
    if (note) note.remove();
  }

  function patchBenefits() {
    each('section[data-framer-name="benefits-custom"]', patchBenefitsSection);
  }

  function patchBenefitsSection(section) {
    section.querySelectorAll("h2").forEach(function (heading) {
      text(heading, "Features you will love");
    });
    findTexts(section, function (value) {
      return value.indexOf("Everything a solo founder") === 0 || value.indexOf("Run 2–5 businesses?") === 0;
    }).forEach(function (subtitle) {
      text(subtitle, "Run 2–5 businesses? See every reply, lead and follow-up without checking each account separately.");
    });

    var replacements = {
      "Every mailbox connects with AES-256 encryption. Your passwords stay encrypted at rest, and your mail is never sold or used to train AI.": "Connect Gmail, Outlook and custom-domain accounts. Keep each business address separate.",
      "Never miss a client reply. Get notified the moment any inbox receives mail, so you’re always in the loop.": "See important emails first. Smart sorting helps you act before leads and follow-ups go cold.",
      "Never miss a client reply. Get notified the moment any inbox receives mail, so you are always in the loop.": "See important emails first. Smart sorting helps you act before leads and follow-ups go cold.",
      "Search every inbox at once. Find any email from any account in seconds, without tab-hopping between webmail.": "Find any email without remembering which business received it."
    };
    section.querySelectorAll("p").forEach(function (paragraph) {
      var old = (paragraph.textContent || "").replace(/\s+/g, " ").trim();
      if (replacements[old]) text(paragraph, replacements[old]);
    });
  }

  function patchProviders() {
    each(".uni-flow", function (flow) {
      var eyebrow = flow.querySelector(".uf-eyebrow"); if (eyebrow) eyebrow.style.display = "none";
      var h2 = flow.querySelector(".uf-h2");
      if (h2 && h2.getAttribute("data-split-copy") !== "v1") {
        h2.setAttribute("data-split-copy", "v1");
        h2.innerHTML = '<span style="color:rgba(10,37,64,.4)">Every business. Every inbox.</span> One clear view.';
      }
      text(flow.querySelector(".uf-sub"), "Connect Gmail, Outlook and custom domains. Keep your providers, identities and addresses exactly as they are.");
    });
  }

  function patchNotifications() {
    each(".uni-notif", patchNotificationsSection);
  }

  function patchNotificationsSection(section) {
    text(section.querySelector(".un-h2"), "Know what needs your attention.");
    text(section.querySelector(".un-sub"), "Smart sorting puts replies, leads and follow-ups first, so you spend less time checking and more time running your businesses.");

    var pills = ["Replies", "Leads", "Follow-ups", "VIP senders", "Needs a reply", "Waiting on client", "Snoozed", "Newsletters"];
    section.querySelectorAll(".un-pill").forEach(function (pill, i) { if (pills[i]) text(pill, pills[i]); });
    var cards = [
      ["New lead", "A new enquiry arrived for Northstar Studio", "now"],
      ["Reply needed", "Client reply in your property business", "2m"],
      ["Follow-up due", "Check in with the Westside quote", "1h"]
    ];
    section.querySelectorAll(".un-card").forEach(function (card, i) {
      if (!cards[i]) return;
      text(card.querySelector(".un-tx b"), cards[i][0]);
      text(card.querySelector(".un-tx s"), cards[i][1]);
      text(card.querySelector(".un-t"), cards[i][2]);
    });
    text(section.querySelector(".un-foot"), "Smart sorting on: only emails that need action reach you");
  }

  function patchTestimonials() {
    each('section[data-framer-name="testimonials"]', patchTestimonialsSection);
  }

  function patchTestimonialsSection(section) {
    var labels = section.querySelectorAll("p");
    labels.forEach(function (paragraph) {
      var value = (paragraph.textContent || "").replace(/\s+/g, " ").trim();
      if (value === "Why people") text(paragraph, "Built for owner-operators");
      if (value === "love OneInbox.") text(paragraph, "with less to check.");
    });
    // The mobile carousel (.uni-car-track) carries its final quotes, names
    // and avatars baked into the markup; cycling it here alongside the
    // ticker cards would rotate its cards out of order. Patch only the rest.
    function outsideCarousel(p) { return !p.closest(".uni-car-track"); }
    var quotes = Array.prototype.filter.call(section.querySelectorAll("p.framer-styles-preset-1k7v3ke"), function (p) {
      return outsideCarousel(p) && (p.textContent || "").trim().length > 70;
    });
    var names = Array.prototype.filter.call(section.querySelectorAll("p.framer-styles-preset-1spabvc"), function (p) {
      return outsideCarousel(p) && (p.textContent || "").trim().length > 2 && (p.textContent || "").trim() !== "Testimonials";
    });
    quotes.forEach(function (paragraph, i) { text(paragraph, TESTIMONIALS[i % TESTIMONIALS.length].quote); });
    names.forEach(function (paragraph, i) { text(paragraph, TESTIMONIALS[i % TESTIMONIALS.length].name); });

    // Framer repeats the ticker cards for its loop and responsive variants. The
    // avatar wrapper is stable across those copies, so update only those images
    // and keep the decorative star icons untouched.
    var avatars = Array.prototype.filter.call(section.querySelectorAll('[data-framer-name="memoji"] img'), outsideCarousel);
    avatars.forEach(function (img, i) {
      var avatar = TESTIMONIAL_AVATARS[i % TESTIMONIAL_AVATARS.length];
      if (img.getAttribute("data-avatar-version") === COPY_VERSION && img.getAttribute("src") === avatar) return;
      img.setAttribute("data-avatar-version", COPY_VERSION);
      img.setAttribute("src", avatar);
      img.removeAttribute("srcset");
    });
  }

  function patchCta() {
    ["cta section", "desktop"].forEach(function (name) {
      each('section[data-framer-name="' + name + '"]', function (section) {
        section.querySelectorAll("h2").forEach(function (heading) {
          text(heading, "Feel in control across every business.");
        });
        section.querySelectorAll("p.framer-styles-preset-1k7v3ke").forEach(function (paragraph) {
          text(paragraph, "Connect your existing accounts, keep each address separate and see what needs attention in one place.");
        });
      });
    });
  }

  function patchFaq() {
    each('section[data-framer-name="faq"]', patchFaqSection);
  }

  function patchFaqSection(section) {
    // Two-line heading, one pair per breakpoint variant: even indexes are
    // the first line, odd indexes the second.
    section.querySelectorAll("h2").forEach(function (heading, i) {
      text(heading, i % 2 === 0 ? "Questions owner-operators" : "ask.");
    });
    findTexts(section, function (value) {
      return value.indexOf("Got questions?") === 0 || value.indexOf("Simple answers") === 0;
    }).forEach(function (subtitle) {
      text(subtitle, "Simple answers before you connect your accounts.");
    });
    // index within each accordion block: a section can hold one block per
    // breakpoint variant, and item order restarts inside every block
    section.querySelectorAll(".uni-faq").forEach(function (block) {
      var existing = block.querySelectorAll(".uni-faq-item");
      for (var n = existing.length; existing.length > 0 && n < FAQ_COPY.length; n++) {
        block.appendChild(existing[0].cloneNode(true));
      }
      block.querySelectorAll(".uni-faq-item").forEach(function (item, i) {
        var copy = FAQ_COPY[i];
        if (!copy) return;
        var question = item.querySelector(".uni-faq-qt");
        var answer = item.querySelector(".uni-faq-ai p");
        if (question) text(question, copy.q);
        if (answer) text(answer, copy.a);
      });
    });
  }

  function makeBillingToggle(title) {
    if (!title || title.querySelector("[data-billing-toggle]")) return;
    title.innerHTML = '<span data-billing-label>Monthly</span>' +
      '<label class="uni-billing-toggle" data-billing-toggle>' +
        '<input type="checkbox" aria-label="Switch to yearly billing" />' +
        '<span class="uni-toggle-track" aria-hidden="true"></span>' +
        '<span class="uni-toggle-copy">Yearly<small>Save 20%</small></span>' +
      '</label>';
  }

  function setMonthlyPrice(card, yearly) {
    if (!card) return;
    var slider = card.querySelector(".uni-slider");
    var accounts = slider ? Math.max(5, Math.min(10, parseInt(slider.value || "5", 10))) : 5;
    var monthly = 10 + (2 * (accounts - 5));
    // Keep the advertised entry price at the requested $97/year while
    // scaling higher account counts from the same 20% annual discount.
    var amount = yearly ? Math.max(97, Math.ceil(monthly * 12 * 0.8)) : monthly;
    var output = card.querySelector("[data-out]");
    var per = card.querySelector(".uni-per");
    var label = card.querySelector("[data-billing-label]");
    var note = card.querySelector("[data-billing-note]");
    if (output) text(output, "$" + amount);
    if (per) text(per, yearly ? "/year" : "/month");
    if (label) text(label, yearly ? "Yearly" : "Monthly");
    if (note) text(note, yearly ? "Billed once a year · save 20%" : "Switch to yearly and save 20%");
    card.setAttribute("data-billing", yearly ? "yearly" : "monthly");
    var buy = card.querySelector('[data-buy="monthly"]');
    if (buy) {
      buy.setAttribute("href", isWaitlist ? "#waitlist" : "/app/signup?plan=" + (yearly ? "yearly" : "monthly") + "&accounts=" + accounts);
      buy.setAttribute("data-billing", yearly ? "yearly" : "monthly");
      buy.setAttribute("data-accounts", String(accounts));
    }
  }

  function patchPricing() {
    each('section[data-framer-name="footer"]', patchPricingSection);
  }

  function patchPricingSection(section) {
    section.querySelectorAll("h2").forEach(function (heading) {
      text(heading, "Simple pricing");
    });
    section.querySelectorAll("p.framer-styles-preset-1k7v3ke").forEach(function (paragraph) {
      text(paragraph, "One plan. Up to 10 accounts. No surprise fees.");
    });

    var cards = section.querySelectorAll(".uni-pcard");
    if (cards.length < 2) return;
    var monthly = cards[0];
    var lifetime = cards[1];
    var title = monthly.querySelector(".uni-ptitle");
    makeBillingToggle(title);
    if (title && title.querySelector("[data-billing-toggle]") && !title.querySelector("[data-billing-toggle]").dataset.bound) {
      var toggle = title.querySelector('input[type="checkbox"]');
      toggle.addEventListener("change", function () { setMonthlyPrice(monthly, toggle.checked); });
      title.querySelector("[data-billing-toggle]").dataset.bound = "true";
      title.querySelector("[data-billing-toggle]").setAttribute("aria-label", "Yearly billing saves 20 percent");
    }
    var monthlyDesc = monthly.querySelector(".uni-pdesc");
    if (monthlyDesc && !monthlyDesc.querySelector("[data-acct]")) monthlyDesc.innerHTML = '<b data-acct>5</b> email accounts included';
    if (monthly.querySelector(".uni-slider")) {
      monthly.querySelector(".uni-slider").setAttribute("max", "10");
      var scale = monthly.querySelectorAll(".uni-scale span");
      if (scale.length > 1) text(scale[1], "10 accounts");
    }
    if (!monthly.querySelector("[data-billing-note]")) {
      var note = document.createElement("div");
      note.className = "uni-billing-note";
      note.setAttribute("data-billing-note", "true");
      note.textContent = "Switch to yearly and save 20%";
      var desc = monthly.querySelector(".uni-pdesc");
      if (desc && desc.parentNode) desc.parentNode.insertBefore(note, desc.nextSibling);
    }

    var lifetimeTitle = lifetime.querySelector(".uni-ptitle");
    if (lifetimeTitle && lifetimeTitle.getAttribute("data-copy-version") !== COPY_VERSION) {
      lifetimeTitle.setAttribute("data-copy-version", COPY_VERSION);
      lifetimeTitle.innerHTML = '<span>One-time purchase</span><span class="uni-ribbon"><svg class="uni-medal" viewBox="0 0 48 52" aria-hidden="true"><path fill="#fff" d="M16 30l-7 16 9-4 4 8 7-15z"/><path fill="#fff" d="M32 30l7 16-9-4-4 8-7-15z"/><g fill="#fff"><circle cx="39" cy="20" r="6.5"/><circle cx="37" cy="27.5" r="6.5"/><circle cx="31.5" cy="33" r="6.5"/><circle cx="24" cy="35" r="6.5"/><circle cx="16.5" cy="33" r="6.5"/><circle cx="11" cy="27.5" r="6.5"/><circle cx="9" cy="20" r="6.5"/><circle cx="11" cy="12.5" r="6.5"/><circle cx="16.5" cy="7" r="6.5"/><circle cx="24" cy="5" r="6.5"/><circle cx="31.5" cy="7" r="6.5"/><circle cx="37" cy="12.5" r="6.5"/><circle cx="24" cy="20" r="16"/></g><circle cx="24" cy="20" r="12.5" fill="#fff"/><circle cx="24" cy="20" r="12.5" fill="rgba(12,125,255,.06)"/><path fill="#4F8EF7" d="M24 12.6l2.3 4.7 5.2.8-3.8 3.6.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.6 5.2-.8z"/><path fill="rgba(255,255,255,.35)" d="M24 15l1.5 3.1 3.4.5-2.5 2.4.6 3.4-3-1.6-3 1.6.6-3.4-2.5-2.4 3.4-.5z"/></svg>Best value</span>';
    }
    var lifetimeAmount = lifetime.querySelector(".uni-amt");
    var lifetimePer = lifetime.querySelector(".uni-per");
    var lifetimeDesc = lifetime.querySelector(".uni-pdesc");
    if (lifetimeAmount) text(lifetimeAmount, "$97");
    if (lifetimePer) text(lifetimePer, "one-time");
    if (lifetimeDesc && (lifetimeDesc.textContent || "").indexOf("no more to pay") < 0) lifetimeDesc.innerHTML = "Up to <b>10</b> email accounts · no more to pay";

    var monthlyFeatures = [
      "One clear view across every business",
      "Colour-coded inboxes",
      "Smart sorting for replies, leads and follow-ups",
      "Reply from the right business address",
      "Cancel anytime"
    ];
    var lifetimeFeatures = [
      "Everything in Monthly",
      "Pay once. No more to pay.",
      "Up to 10 email accounts",
      "Future updates included",
      "Priority support"
    ];
    monthly.querySelectorAll(".uni-feats li").forEach(function (li, i) { if (monthlyFeatures[i]) text(li, monthlyFeatures[i]); });
    lifetime.querySelectorAll(".uni-feats li").forEach(function (li, i) { if (lifetimeFeatures[i]) text(li, lifetimeFeatures[i]); });
    setMonthlyPrice(monthly, monthly.getAttribute("data-billing") === "yearly");
  }

  function patchFooterCopy() {
    each("footer", function (footer) {
      var description = findText(footer, function (value) {
        return value.indexOf("One clutter-free inbox") === 0 || value.indexOf("One clear view across") === 0 || value.indexOf("One clear view of replies") === 0;
      });
      if (description) text(description, "One clear view of replies, leads and follow-ups across every business you run.");
    });
  }

  function applyAll() {
    setMeta();
    patchHero();
    patchSecurity();
    patchBenefits();
    patchProviders();
    patchNotifications();
    patchTestimonials();
    patchCta();
    patchFaq();
    patchPricing();
    patchFooterCopy();
  }

  var slideWrapped = false;
  function wrapSlider() {
    if (slideWrapped || typeof window.uniSlide !== "function") return;
    var original = window.uniSlide;
    window.uniSlide = function (el, type) {
      original(el, type);
      patchPricing();
    };
    slideWrapped = true;
  }

  var timer = null;
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      wrapSlider();
      applyAll();
    }, delay || 180);
  }

  // Framer hydrates the exported page after these scripts are parsed. A
  // permanent DOM observer can race React's reconciliation and cause a
  // removeChild error, so use a few delayed passes instead. The page is then
  // left alone; the only ongoing behavior is the explicit pricing controls.
  schedule(900);
  setTimeout(function () { wrapSlider(); applyAll(); }, 1800);
  setTimeout(function () { wrapSlider(); applyAll(); }, 3200);
  window.addEventListener("resize", function () { schedule(240); });
})();
