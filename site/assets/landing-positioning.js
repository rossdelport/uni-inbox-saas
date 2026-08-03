(function () {
  "use strict";

  if (window.__oneInboxPositioningRefresh) return;
  window.__oneInboxPositioningRefresh = true;

  var isWaitlist = Boolean(window.__uniWaitlistPage);
  var COPY_VERSION = "owner-operator-v2";

  var TESTIMONIALS = [
    {
      quote: "I run three businesses and used to check seven inboxes before breakfast. One Inbox shows me what needs attention in one view, so I start the day calm.",
      name: "Maya Thompson · owner of three service businesses"
    },
    {
      quote: "I stopped missing leads because I can see which business each message belongs to. I reply from the right account without thinking about it.",
      name: "Daniel Brooks · founder of two online brands"
    },
    {
      quote: "Every new business used to mean another tab and another password. Now I see replies and follow-ups together and get back to running the work.",
      name: "Priya Shah · owner-operator"
    },
    {
      quote: "One Inbox gives me control without moving my email or changing providers. I save hours every week and know nothing important is hiding.",
      name: "Chris Morgan · multi-business owner"
    }
  ];

  var FAQ_COPY = [
    {
      q: "Which email providers can I connect?",
      a: "Gmail, Outlook, and custom-domain accounts that support IMAP and SMTP. Proton Mail, Tuta, and HEY Mail cannot be connected because they block third-party access."
    },
    {
      q: "Does One Inbox replace Gmail or Outlook?",
      a: "No. Keep using your providers. One Inbox connects to them and gives you one clear view across every business."
    },
    {
      q: "Do I move or forward my email?",
      a: "No. Your mail stays with your provider. One Inbox connects to your existing accounts and syncs them into your workspace."
    },
    {
      q: "Can I reply from the right business?",
      a: "Yes. Replies go from the address that received the thread, so each business keeps its own identity."
    }
  ];

  function text(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function findText(root, matcher) {
    var nodes = root ? root.querySelectorAll("h1,h2,h3,h4,p,a,button,span") : [];
    for (var i = 0; i < nodes.length; i += 1) {
      var value = (nodes[i].textContent || "").replace(/\s+/g, " ").trim();
      if (matcher(value, nodes[i])) return nodes[i];
    }
    return null;
  }

  function setMeta() {
    var title = "OneInbox | Know what needs your attention across every business";
    if (document.title !== title) document.title = title;
    var description = "One inbox turns all your email accounts into one clear list of replies, leads and follow-ups for owner-operators running multiple businesses.";
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", description);
    document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach(function (el) {
      el.setAttribute("content", "OneInbox | Know what needs your attention across every business");
    });
    document.querySelectorAll('meta[property="og:description"], meta[name="twitter:description"]').forEach(function (el) {
      el.setAttribute("content", description);
    });
  }

  function patchHero() {
    var hero = document.querySelector('section[data-framer-name="hero"]');
    if (!hero) return;

    var heads = hero.querySelectorAll("h1");
    if (heads.length > 0) text(heads[0], "Know what needs your attention");
    if (heads.length > 1) text(heads[1], "across every business.");

    var badge = findText(hero, function (value) {
      return value === "Built for solo founders and indie hackers" || value === "Running multiple businesses?" || value === "Launching soon";
    });
    if (badge) text(badge, "Launching soon");

    var subline = findText(hero, function (value) {
      return value.indexOf("Connect Gmail") === 0 || value.indexOf("One Inbox turns every email account") === 0 || value.indexOf("One inbox turns all your email accounts") === 0;
    });
    if (subline) text(subline, "One inbox turns all your email accounts into one clear list of replies, leads and follow-ups. Easily see important emails with colour coded inboxes and smart sorting. Save hours and get more done.");

    var trust = hero.querySelector(".uni-trust span");
    if (trust && trust.getAttribute("data-copy-version") !== COPY_VERSION) {
      trust.setAttribute("data-copy-version", COPY_VERSION);
      trust.innerHTML = "<b>All your accounts are encrypted.</b> No forwarding. No migration. No switching providers";
    }
  }

  function patchSecurity() {
    var section = document.querySelector("section[data-uni-sec]");
    if (!section) return;
    var heading = section.querySelector("h2");
    if (heading && heading.getAttribute("data-copy-version") !== COPY_VERSION) {
      heading.setAttribute("data-copy-version", COPY_VERSION);
      heading.innerHTML = "Your business email stays <span>under your control</span>.";
    }
    var lead = section.querySelector(".uni-sec-lead");
    if (lead) text(lead, "Connect Gmail, Outlook and custom domains. See what needs attention without giving up your providers, addresses or business identities.");

    var cards = section.querySelectorAll(".uni-card");
    var cardCopy = [
      ["Your passwords stay protected", "Mailbox passwords are encrypted with <b>AES-256-GCM</b> before storage. With Google or Microsoft, One Inbox receives a token instead of your password."],
      ["Your mail stays encrypted", "Connections run over <b>TLS</b>, and stored data sits on encrypted infrastructure while your accounts keep working as normal."],
      ["Each business stays separate", "Account rules keep every message tied to its owner. Your business inboxes stay separated even when you view them together."],
      ["We do not sell your mail", "One Inbox is paid for by subscriptions. We do not sell or share your email, and optional AI features are always your choice."]
    ];
    for (var i = 0; i < cards.length && i < cardCopy.length; i += 1) {
      var cardHeading = cards[i].querySelector("h3");
      var cardParagraph = cards[i].querySelector("p");
      if (cardHeading) text(cardHeading, cardCopy[i][0]);
      if (cardParagraph && cardParagraph.innerHTML !== cardCopy[i][1]) cardParagraph.innerHTML = cardCopy[i][1];
    }

    var note = section.querySelector(".uni-note");
    if (note && note.getAttribute("data-copy-version") !== COPY_VERSION) {
      note.setAttribute("data-copy-version", COPY_VERSION);
      note.innerHTML = "<h4>What changes when I connect an account?</h4><p>Nothing moves. One Inbox connects to your existing accounts and shows them in one workspace. Each business keeps its own address, and you can disconnect any account at any time. <a href=\"/privacy\">Read the privacy policy</a></p>";
    }
  }

  function patchBenefits() {
    var section = document.querySelector('section[data-framer-name="benefits-custom"]');
    if (!section) return;
    var heading = section.querySelector("h2");
    var subtitle = findText(section, function (value) {
      return value.indexOf("Everything a solo founder") === 0 || value.indexOf("Run 2–5 businesses?") === 0;
    });
    if (heading) text(heading, "Built for owner-operators with multiple businesses.");
    if (subtitle) text(subtitle, "Run 2–5 businesses? See every reply, lead and follow-up without checking each account separately.");

    var replacements = {
      "Every mailbox connects with AES-256 encryption. Your passwords stay encrypted at rest, and your mail is never sold or used to train AI.": "Connect Gmail, Outlook and custom-domain accounts. Keep each business address separate.",
      "Never miss a client reply. Get notified the moment any inbox receives mail, so you’re always in the loop.": "See important emails first. Smart sorting helps you act before leads and follow-ups go cold.",
      "Search every inbox at once. Find any email from any account in seconds, without tab-hopping between webmail.": "Find any email without remembering which business received it."
    };
    section.querySelectorAll("p").forEach(function (paragraph) {
      var old = (paragraph.textContent || "").replace(/\s+/g, " ").trim();
      if (replacements[old]) text(paragraph, replacements[old]);
    });
  }

  function patchProviders() {
    var flow = document.querySelector(".uni-flow");
    if (!flow) return;
    text(flow.querySelector(".uf-eyebrow"), "YOUR ACCOUNTS");
    text(flow.querySelector(".uf-h2"), "Every business. Every inbox. One clear view.");
    text(flow.querySelector(".uf-sub"), "Connect Gmail, Outlook and custom domains. Keep your providers, identities and addresses exactly as they are.");
  }

  function patchNotifications() {
    var section = document.querySelector(".uni-notif");
    if (!section) return;
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
    var section = document.querySelector('section[data-framer-name="testimonials"]');
    if (!section) return;
    var labels = section.querySelectorAll("p");
    labels.forEach(function (paragraph) {
      var value = (paragraph.textContent || "").replace(/\s+/g, " ").trim();
      if (value === "Why people") text(paragraph, "Built for owner-operators");
      if (value === "love OneInbox.") text(paragraph, "with less to check.");
    });
    var quotes = Array.prototype.filter.call(section.querySelectorAll("p.framer-styles-preset-1k7v3ke"), function (p) {
      return (p.textContent || "").trim().length > 70;
    });
    var names = Array.prototype.filter.call(section.querySelectorAll("p.framer-styles-preset-1spabvc"), function (p) {
      return (p.textContent || "").trim().length > 2 && (p.textContent || "").trim() !== "Testimonials";
    });
    quotes.forEach(function (paragraph, i) { text(paragraph, TESTIMONIALS[i % TESTIMONIALS.length].quote); });
    names.forEach(function (paragraph, i) { text(paragraph, TESTIMONIALS[i % TESTIMONIALS.length].name); });
  }

  function patchCta() {
    ["cta section", "desktop"].forEach(function (name) {
      var section = document.querySelector('section[data-framer-name="' + name + '"]');
      if (!section) return;
      var heading = section.querySelector("h2");
      var paragraph = section.querySelector("p.framer-styles-preset-1k7v3ke");
      if (heading) text(heading, "Feel in control across every business.");
      if (paragraph) text(paragraph, "Connect your existing accounts, keep each address separate and see what needs attention in one place.");
    });
  }

  function patchFaq() {
    var section = document.querySelector('section[data-framer-name="faq"]');
    if (!section) return;
    var headings = section.querySelectorAll("h2");
    if (headings.length > 0) text(headings[0], "Questions owner-operators");
    if (headings.length > 1) text(headings[1], "ask.");
    var subtitle = findText(section, function (value) {
      return value.indexOf("Got questions?") === 0 || value.indexOf("Simple answers") === 0;
    });
    if (subtitle) text(subtitle, "Simple answers before you connect your accounts.");
    section.querySelectorAll(".uni-faq-item").forEach(function (item, i) {
      var copy = FAQ_COPY[i];
      if (!copy) return;
      var question = item.querySelector(".uni-faq-qt");
      var answer = item.querySelector(".uni-faq-ai p");
      if (question) text(question, copy.q);
      if (answer) text(answer, copy.a);
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
      buy.setAttribute("href", isWaitlist ? "#waitlist" : "/app/signup");
      buy.setAttribute("data-billing", yearly ? "yearly" : "monthly");
      buy.setAttribute("data-accounts", String(accounts));
    }
  }

  function patchPricing() {
    var section = document.querySelector('section[data-framer-name="footer"]');
    if (!section) return;
    var heading = section.querySelector("h2");
    var paragraph = section.querySelector("p.framer-styles-preset-1k7v3ke");
    if (heading) text(heading, "Simple pricing for every business you run.");
    if (paragraph) text(paragraph, "One plan. Up to 10 accounts. No surprise fees.");

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
      lifetimeTitle.innerHTML = '<span>One-time purchase</span><span class="uni-ribbon">Best value</span>';
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
    var footer = document.querySelector("footer");
    if (!footer) return;
    var description = findText(footer, function (value) {
      return value.indexOf("One clutter-free inbox") === 0 || value.indexOf("One clear view across") === 0 || value.indexOf("One clear view of replies") === 0;
    });
    if (description) text(description, "One clear view of replies, leads and follow-ups across every business you run.");
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
