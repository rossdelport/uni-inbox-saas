// Footer legal links, restored after Framer hydration.
//
// The exported HTML was hand-edited to turn the template's "404" footer item
// into a Terms of Service link, but Framer re-renders the footer from its
// bundled template data on hydration, so the edit vanishes a moment after
// load. Hydration also rewrites hrefs to relative ("./privacy-policy",
// "./404"), so match loosely rather than on exact paths. Repurposing the
// resurrected 404 item in place sticks across React's reconciliation the same
// way landing-positioning.js's copy patches do; inserting new nodes does not.
(function () {
  function ensureTerms() {
    var footer = document.querySelector("footer");
    if (!footer) return;
    var privacy = null, terms = null, notFound = null;
    footer.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (!privacy && href.indexOf("privacy") >= 0) privacy = a;
      if (!terms && href.indexOf("service") >= 0) terms = a;
      if (!notFound && href.indexOf("404") >= 0) notFound = a;
    });

    if (terms) {
      if ((terms.textContent || "").trim() !== "Terms of Service") terms.textContent = "Terms of Service";
      return;
    }
    if (notFound) {
      notFound.setAttribute("href", "/service");
      notFound.textContent = "Terms of Service";
      var wrap = notFound.closest('[data-framer-component-type="RichTextContainer"]');
      if (wrap) wrap.setAttribute("data-framer-name", "Terms of Service");
      return;
    }
    if (privacy) {
      // No 404 item to repurpose: rebuild the link as a styled sibling of the
      // Privacy block. Least durable path, so it comes last.
      var block = privacy.closest('[data-framer-component-type="RichTextContainer"]');
      if (!block || !block.parentNode) return;
      var copy = block.cloneNode(true);
      copy.setAttribute("data-framer-name", "Terms of Service");
      var link = copy.querySelector("a");
      if (!link) return;
      link.setAttribute("href", "/service");
      link.textContent = "Terms of Service";
      block.parentNode.insertBefore(copy, block.nextSibling);
    }
  }

  // The Social Media column (its header and the placeholder icon links) is
  // retired. Climb from the header to the widest ancestor that holds only
  // this column, so the icons go with it and the other columns stay.
  function dropSocial() {
    var footer = document.querySelector("footer");
    if (!footer) return;
    footer.querySelectorAll("p").forEach(function (p) {
      if ((p.textContent || "").trim() !== "Social Media") return;
      var col = p;
      while (col.parentElement && col.parentElement !== footer) {
        var parentText = col.parentElement.textContent || "";
        if (parentText.indexOf("Legal") >= 0 || parentText.indexOf("Menu") >= 0) break;
        col = col.parentElement;
      }
      if (col.parentNode) col.parentNode.removeChild(col);
    });
  }

  function pass() {
    ensureTerms();
    dropSocial();
  }

  setTimeout(pass, 900);
  setTimeout(pass, 1800);
  setTimeout(pass, 3200);
  setTimeout(pass, 6000);
})();
