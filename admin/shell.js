/* ===========================================================================
   Qalam & Ahar — one dashboard
   Sveltia is the dashboard; the page builder lives inside it. This script
   injects a "Page" item at the top of Sveltia's collection sidebar which
   opens admin/builder.html as a full-viewport overlay — same sign-in (the
   token is shared), no second surface to know about. Closing the overlay
   returns to Sveltia exactly where you were.

   Like the focus-follow in preview.js, this leans on Sveltia's light-DOM
   structure (a role=listbox of role=option collections) at the pinned
   version. If a version bump reshuffles that DOM, the worst case is the
   "Page" item not appearing — builder.html keeps working directly.
   =========================================================================== */

(function () {
  "use strict";

  var MARKER = "pure-shell-page-option";
  var OVERLAY_ID = "pure-shell-builder-overlay";

  /* --- the overlay ---------------------------------------------------------- */

  function openBuilder() {
    if (document.getElementById(OVERLAY_ID)) return;

    var iframe = document.createElement("iframe");
    iframe.id = OVERLAY_ID;
    iframe.src = "builder.html";
    iframe.title = "Page builder";
    iframe.style.cssText =
      "position: fixed; inset: 0; z-index: 2147483000; width: 100%; height: 100%; " +
      "border: 0; background: #191016;";
    document.body.appendChild(iframe);
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === "pure-builder:close") {
      var overlay = document.getElementById(OVERLAY_ID);
      if (overlay) overlay.remove();
    }
  });

  /* --- the sidebar item ------------------------------------------------------ */

  /** Build a "Page" option that inherits the native look by cloning an
      existing collection option, keeping its scoped style classes. */
  function buildOption(template) {
    var option = /** @type {HTMLElement} */ (template.cloneNode(true));
    var icon = null;

    option.classList.add(MARKER);
    option.removeAttribute("id");
    option.setAttribute("aria-selected", "false");

    // Keep only the icon element; the rest becomes our own label.
    Array.from(option.childNodes).forEach(function (node) {
      if (!icon && node.nodeType === 1 && /** @type {HTMLElement} */ (node).textContent.trim()) {
        icon = node;
        icon.textContent = "web";
      } else {
        node.remove();
      }
    });
    option.appendChild(document.createTextNode("Page"));

    option.addEventListener(
      "click",
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        openBuilder();
      },
      true
    );

    return option;
  }

  function inject() {
    if (document.querySelector("." + MARKER)) return;

    var option = document.querySelector('[role="listbox"] [role="option"]');
    if (!option || !option.parentElement) return;

    option.parentElement.insertBefore(buildOption(option), option);
  }

  var scheduled = false;

  new MutationObserver(function () {
    // Coalesce bursts of mutations (Sveltia re-renders whole views).
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      inject();
    });
  }).observe(document.body, { childList: true, subtree: true });

  inject();
})();
