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

  function openBuilder(focus) {
    if (document.getElementById(OVERLAY_ID)) return;

    var iframe = document.createElement("iframe");
    iframe.id = OVERLAY_ID;
    iframe.src = "builder.html" + (focus ? "?focus=" + encodeURIComponent(focus) : "");
    iframe.title = "Page builder";
    iframe.style.cssText =
      "position: fixed; inset: 0; z-index: 2147483000; width: 100%; height: 100%; " +
      "border: 0; background: #191016;";
    document.body.appendChild(iframe);
  }

  /** What the current CMS route points at, as a builder focus target. */
  function currentFocus() {
    var match = /#\/collections\/(pages|symbols)\/entries\/([^/?]+)/.exec(location.hash);
    if (!match) return null;
    return (match[1] === "pages" ? "page:" : "symbol:") + decodeURIComponent(match[2]);
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
    option.appendChild(document.createTextNode("Builder"));

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
    injectSidebarItem();
    injectMenuItem();
  }

  function injectSidebarItem() {
    if (document.querySelector("." + MARKER)) return;

    var option = document.querySelector('[role="listbox"] [role="option"]');
    if (!option || !option.parentElement) return;

    option.parentElement.insertBefore(buildOption(option), option);
  }

  /* On a Pages or Symbols entry, the entry's ⋮ menu gains "Edit in builder",
     opening the builder scoped to that page or symbol. The menu is recognised
     by its Revert Changes item, so field-level menus are left alone. */

  var MENU_MARKER = "pure-shell-menu-item";

  function injectMenuItem() {
    var focus = currentFocus();
    if (!focus || document.querySelector("." + MENU_MARKER)) return;

    var revert = Array.from(document.querySelectorAll('[role="menuitem"]')).find(function (item) {
      return /revert changes/i.test(item.textContent);
    });
    if (!revert || !revert.parentElement) return;

    var item = /** @type {HTMLElement} */ (revert.cloneNode(true));
    item.classList.add(MENU_MARKER);
    item.removeAttribute("id");
    item.removeAttribute("aria-disabled");
    item.removeAttribute("disabled");

    // Keep the native structure; swap only the visible label text.
    var labelled = false;
    item.querySelectorAll("*").forEach(function (node) {
      if (!labelled && node.children.length === 0 && node.textContent.trim()) {
        node.textContent = "Edit in builder";
        labelled = true;
      }
    });
    if (!labelled) item.textContent = "Edit in builder";

    item.addEventListener(
      "click",
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        openBuilder(focus);
      },
      true
    );

    revert.parentElement.insertBefore(item, revert);
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
