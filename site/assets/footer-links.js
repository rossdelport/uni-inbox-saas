// Footer legal links, restored after Framer hydration.
//
// The exported HTML was hand-edited to turn the template's "404" footer item
// into a Terms of Service link, but Framer re-renders the footer from its
// bundled template data on hydration, so the edit vanishes a moment after
// load. Mirroring landing-positioning.js, this waits for hydration to settle
// (delayed passes, no persistent observer) and then makes sure the Legal
// column reads Privacy Policy then Terms of Service.
(function () {
  function ensureTerms() {
    var footer = document.querySelector("footer");
    if (!footer) return;
    var privacy = footer.querySelector('a[href="/privacy"], a[href="/privacy-policy"], a[href="/privacy-policy/"]');
    if (!privacy) return;

    var terms = footer.querySelector('a[href="/service"], a[href="/service/"]');
    if (terms) {
      if ((terms.textContent || "").trim() !== "Terms of Service") terms.textContent = "Terms of Service";
    } else {
      // Rebuild the link as a sibling of the Privacy block so it inherits the
      // exact same Framer classes and stack layout.
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

    // If hydration resurrected the template's 404 item, retire it: the Legal
    // column should never advertise an error page.
    footer.querySelectorAll('a[href="/404"], a[href="/404/"]').forEach(function (a) {
      var item = a.closest('[data-framer-component-type="RichTextContainer"]');
      if (item && item.parentNode) item.parentNode.removeChild(item);
    });
  }

  setTimeout(ensureTerms, 900);
  setTimeout(ensureTerms, 1800);
  setTimeout(ensureTerms, 3200);
})();
