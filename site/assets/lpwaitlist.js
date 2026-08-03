(function () {
  "use strict";

  if (window.__oneInboxWaitlistClone) return;
  window.__oneInboxWaitlistClone = true;

  var SESSION_KEY = "oi-waitlist-session";
  var CTA_LABELS = [
    "start today",
    "get started",
    "try for free",
    "get started today",
    "get lifetime access",
  ];

  function textOf(element) {
    return (element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function normal(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function setButtonLabel(anchor, value) {
    var paragraphs = anchor.querySelectorAll("p");
    if (paragraphs.length) {
      paragraphs.forEach(function (paragraph) {
        paragraph.textContent = value;
      });
    } else {
      anchor.textContent = value;
    }
  }

  function placementFor(anchor) {
    if (anchor.closest("nav")) return "nav";
    if (anchor.closest('section[data-framer-name="hero"]')) return "hero";
    if (anchor.closest(".uni-pcard")) return "pricing";
    if (anchor.closest('section[data-framer-name="cta section"], section[data-framer-name="desktop"]')) return "mid";
    return "other";
  }

  function sourceFor(anchor, originalLabel, placement) {
    if (placement === "nav") return "nav";
    if (placement === "hero") return "hero";
    if (placement === "mid") return "mid-cta";
    if (placement === "pricing") {
      return originalLabel.indexOf("lifetime") >= 0 ? "pricing-lifetime" : "pricing-monthly";
    }
    return originalLabel.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "unknown";
  }

  function replacementNode(anchor, placement) {
    if (placement === "nav") {
      var nav = anchor.closest("nav");
      var node = anchor;
      while (node.parentElement && node.parentElement !== nav) node = node.parentElement;
      return node;
    }
    if (placement === "pricing") return anchor;
    return anchor.parentElement || anchor;
  }

  function makeForm(anchor) {
    if (anchor.dataset.waitlistCta === "true" || anchor.closest("form[data-waitlist-form]")) return;

    var originalLabel = normal(textOf(anchor));
    if (CTA_LABELS.indexOf(originalLabel) < 0) return;

    var placement = placementFor(anchor);
    var source = sourceFor(anchor, originalLabel, placement);
    var replaceNode = replacementNode(anchor, placement);
    var parent = replaceNode && replaceNode.parentNode;
    if (!parent) return;

    var layoutHost = placement === "hero" ? anchor.closest('[data-framer-name="btns"]') : null;
    if (layoutHost) layoutHost.classList.add("wl-cta-host");

    var form = document.createElement("form");
    form.className = "wl-form wl-" + placement;
    form.dataset.waitlistForm = "true";
    form.dataset.source = source;
    form.noValidate = false;

    var input = document.createElement("input");
    input.type = "email";
    input.name = "email";
    input.autocomplete = "email";
    input.placeholder = "Your email address";
    input.setAttribute("aria-label", "Email address");
    input.required = true;

    var status = document.createElement("p");
    status.className = "wl-status";
    status.setAttribute("aria-live", "polite");

    anchor.dataset.waitlistCta = "true";
    anchor.dataset.originalLabel = originalLabel;
    anchor.setAttribute("href", "#waitlist");
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
    setButtonLabel(anchor, "Join waitlist");

    parent.insertBefore(form, replaceNode);
    form.appendChild(input);
    form.appendChild(anchor);
    form.appendChild(status);
    if (replaceNode !== anchor && replaceNode.parentNode) replaceNode.remove();
  }

  function patchSections() {
    var hero = document.querySelector('section[data-framer-name="hero"]');
    if (hero) {
      hero.id = "top";
      hero.dataset.waitlistAnchor = "true";
    }

    var security = document.querySelector("section[data-uni-sec]");
    if (security) {
      security.id = "security";
      security.dataset.waitlistAnchor = "true";
    }

    var solutions = document.querySelector('section[data-framer-name="benefits-custom"]');
    if (solutions) {
      solutions.id = "solutions";
      solutions.dataset.waitlistAnchor = "true";
    }

    var features = document.querySelector('section[data-framer-name="features"]');
    if (features) features.dataset.waitlistAnchor = "true";

    var faq = document.querySelector('section[data-framer-name="faq"]');
    if (faq) faq.dataset.waitlistAnchor = "true";

    var pricingHeading = Array.prototype.find.call(document.querySelectorAll("h2"), function (heading) {
      return normal(textOf(heading)) === "simple pricing";
    });
    var pricing = pricingHeading && pricingHeading.closest("section");
    if (pricing) {
      pricing.id = "pricing";
      pricing.dataset.waitlistAnchor = "true";
    }

    var footer = document.querySelector("footer");
    if (footer) {
      footer.id = "contact";
      footer.dataset.waitlistAnchor = "true";
    }
  }

  function patchNavigation() {
    var destinations = {
      home: "#top",
      solutions: "#solutions",
      pricing: "#pricing",
      contact: "#contact",
    };

    document.querySelectorAll("a").forEach(function (anchor) {
      if (anchor.dataset.waitlistCta === "true") return;
      var label = normal(textOf(anchor));
      if (destinations[label]) {
        anchor.setAttribute("href", destinations[label]);
        anchor.removeAttribute("target");
        anchor.removeAttribute("rel");
      }
    });

    document.querySelectorAll('nav a[href="./"], nav a[href="/"], footer a[href="./"], footer a[href="/"]').forEach(function (anchor) {
      if (!normal(textOf(anchor))) anchor.setAttribute("href", "#top");
    });

    document.querySelectorAll('a[href$="#testimonials"], a[href="./#testimonials"]').forEach(function (anchor) {
      anchor.setAttribute("href", "#testimonials");
      anchor.removeAttribute("target");
    });
  }

  function patchPage() {
    patchSections();
    patchNavigation();
    document.querySelectorAll("a").forEach(makeForm);
  }

  function campaignParams() {
    var search = new URLSearchParams(location.search);
    var result = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (key) {
      var value = search.get(key);
      if (value) result[key] = value.slice(0, 160);
    });
    return result;
  }

  function confetti() {
    var layer = document.createElement("div");
    layer.className = "wl-confetti";
    var colors = ["#0c7dff", "#00b050", "#ffad0a", "#ec55a6", "#ffffff"];
    for (var index = 0; index < 76; index += 1) {
      var bit = document.createElement("i");
      bit.style.left = Math.random() * 100 + "%";
      bit.style.setProperty("--wl-drift", (Math.random() - 0.5) * 230 + "px");
      bit.style.setProperty("--wl-delay", Math.random() * 0.32 + "s");
      bit.style.setProperty("--wl-rotate", Math.random() * 90 - 45 + "deg");
      bit.style.setProperty("--wl-color", colors[index % colors.length]);
      layer.appendChild(bit);
    }
    document.body.appendChild(layer);
    setTimeout(function () {
      layer.remove();
    }, 1900);
  }

  function setLoading(form, loading) {
    var anchor = form.querySelector("a[data-waitlist-cta]");
    if (!anchor) return;
    anchor.setAttribute("aria-disabled", loading ? "true" : "false");
    setButtonLabel(anchor, loading ? "Joining…" : "Join waitlist");
  }

  async function submitWaitlist(form) {
    if (form.dataset.submitting === "true") return;
    var input = form.querySelector('input[name="email"]');
    var status = form.querySelector(".wl-status");
    if (!input || !input.reportValidity()) return;

    form.dataset.submitting = "true";
    status.removeAttribute("data-error");
    status.textContent = "Saving your place…";
    setLoading(form, true);

    try {
      var response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({
          email: input.value.trim(),
          source: form.dataset.source || "unknown",
          page_path: location.pathname,
        }, campaignParams())),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || "Could not join the waitlist.");

      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        signup_id: data.signup_id,
        feedback_token: data.feedback_token,
        email_sent: Boolean(data.email_sent),
      }));
      status.textContent = "You’re on the list!";
      confetti();
      setTimeout(function () {
        location.href = "/lpwaitlist/thank-you/";
      }, 850);
    } catch (error) {
      form.dataset.submitting = "false";
      status.dataset.error = "true";
      status.textContent = error && error.message ? error.message : "Could not join the waitlist. Please try again.";
      setLoading(form, false);
    }
  }

  document.addEventListener("click", function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest("a") : null;
    if (!anchor) return;

    if (anchor.matches("a[data-waitlist-cta]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var form = anchor.closest("form[data-waitlist-form]");
      if (form) form.requestSubmit();
      return;
    }

    var href = anchor.getAttribute("href") || "";
    if (href.charAt(0) !== "#" || href.length < 2) return;
    var destination = document.querySelector(href);
    if (!destination) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    history.pushState(null, "", href);
    destination.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }, true);

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.matches || !form.matches("form[data-waitlist-form]")) return;
    event.preventDefault();
    event.stopPropagation();
    void submitWaitlist(form);
  }, true);

  var patchTimer = null;
  function schedulePatch() {
    clearTimeout(patchTimer);
    patchTimer = setTimeout(patchPage, 120);
  }

  new MutationObserver(schedulePatch).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", patchPage);
  else patchPage();
  setTimeout(patchPage, 400);
  setTimeout(patchPage, 1200);
  setTimeout(patchPage, 2600);
})();
