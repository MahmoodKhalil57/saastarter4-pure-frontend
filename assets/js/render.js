/* ===========================================================================
   Qalam & Ahar — shared content renderers
   One copy of the JSON -> HTML logic, used from two places:
     - assets/js/main.js   re-renders live in the visitor's browser
     - admin/builder.js    bakes the same markup into index.html at save time,
                           so the page is complete without JavaScript
   No build step; this file defines window.PureRender and nothing else.
   =========================================================================== */

(function () {
  "use strict";

  /** Read `a.b.c` out of an object, returning undefined rather than throwing. */
  function get(root, path) {
    return String(path)
      .split(".")
      .reduce(function (node, key) {
        return node == null ? undefined : node[key];
      }, root);
  }

  function isFilled(value) {
    if (value == null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  function el(doc, tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* --- renderers ------------------------------------------------------------
     Each takes (container, items, opts). `opts.asset` maps a CMS media path
     (`/media/uploads/x.jpg`) to whatever URL form the caller needs — absolute
     for the live page, root-relative for baked HTML. */

  function renderLots(container, items, opts) {
    var doc = container.ownerDocument;
    container.replaceChildren();

    // Note: no inline styles here on purpose — baked markup must stay pure
    // HTML. The scroll-reveal stagger (--reveal-delay) is applied by main.js.
    items.forEach(function (item) {
      var li = el(doc, "li", "lot");

      var figure = el(doc, "figure", "lot__figure");
      if (isFilled(item.image)) {
        var img = el(doc, "img");
        img.setAttribute("src", opts.asset(item.image));
        img.setAttribute("alt", item.image_alt || item.title || "");
        img.setAttribute("loading", "lazy");
        figure.appendChild(img);
      } else {
        figure.classList.add("lot__figure--empty");
      }
      li.appendChild(figure);

      var meta = el(doc, "p", "lot__meta");
      meta.appendChild(el(doc, "span", null, item.lot ? "Lot " + item.lot : ""));
      if (isFilled(item.status)) meta.appendChild(el(doc, "span", "lot__status", item.status));
      li.appendChild(meta);

      li.appendChild(el(doc, "h3", "lot__title", item.title || ""));
      if (isFilled(item.blurb)) li.appendChild(el(doc, "p", "lot__blurb", item.blurb));
      if (isFilled(item.price)) li.appendChild(el(doc, "p", "lot__price", item.price));

      container.appendChild(li);
    });
  }

  function renderSteps(container, items) {
    var doc = container.ownerDocument;
    container.replaceChildren();

    items.forEach(function (item) {
      var li = el(doc, "li", "step");
      li.appendChild(el(doc, "h3", "step__title", item.title || ""));
      if (isFilled(item.body)) li.appendChild(el(doc, "p", "step__body", item.body));
      container.appendChild(li);
    });
  }

  function renderFaq(container, items) {
    var doc = container.ownerDocument;
    container.replaceChildren();

    items.forEach(function (item) {
      var details = doc.createElement("details");
      var summary = el(doc, "summary", null, item.question || "");
      details.appendChild(summary);
      details.appendChild(el(doc, "p", null, item.answer || ""));
      container.appendChild(details);
    });
  }

  function renderLinks(container, items) {
    var doc = container.ownerDocument;
    container.replaceChildren();

    items.forEach(function (item) {
      if (!isFilled(item.url) || !isFilled(item.label)) return;
      var li = el(doc, "li");
      var a = el(doc, "a", null, item.label);
      a.setAttribute("href", item.url);
      if (/^https?:/.test(item.url)) {
        a.setAttribute("rel", "noopener");
        a.setAttribute("target", "_blank");
      }
      li.appendChild(a);
      container.appendChild(li);
    });
  }

  /** The site menu, rendered from the Pages list (content/pages.json). Only
      pages given a menu label appear; while none have one, the hand-written
      links in the markup are left alone. */
  function renderNav(container, pages) {
    var doc = container.ownerDocument;
    var items = pages.filter(function (page) {
      return isFilled(page.nav_label);
    });

    if (!items.length) return;
    container.replaceChildren();

    items.forEach(function (page) {
      var a = el(doc, "a", null, page.nav_label);
      a.setAttribute("href", page.slug === "index" ? "./" : page.slug + ".html");
      container.appendChild(a);
    });
  }

  var RENDERERS = {
    "catalog.items": renderLots,
    "landing.craft.steps": renderSteps,
    "landing.faq.items": renderFaq,
    "site.contact.links": renderLinks,
    "pages.pages": renderNav,
  };

  /* --- binding ----------------------------------------------------------- */

  /**
   * Apply the content object to every data-text / data-when / data-list hook
   * under `root`. Works on the live document and on a detached DOMParser
   * document alike. `opts.asset` is required only if catalog items carry images.
   */
  function bindAll(root, content, opts) {
    opts = opts || {};
    if (typeof opts.asset !== "function") {
      opts.asset = function (path) {
        return path;
      };
    }

    root.querySelectorAll("[data-text]").forEach(function (node) {
      var value = get(content, node.getAttribute("data-text"));
      if (isFilled(value)) node.textContent = value;
    });

    root.querySelectorAll("[data-when]").forEach(function (node) {
      if (isFilled(get(content, node.getAttribute("data-when")))) {
        node.removeAttribute("hidden");
      } else {
        node.setAttribute("hidden", "");
      }
    });

    root.querySelectorAll("[data-list]").forEach(function (node) {
      var path = node.getAttribute("data-list");
      var items = get(content, path);
      var render = RENDERERS[path];
      if (render && Array.isArray(items) && items.length) render(node, items, opts);
    });
  }

  window.PureRender = {
    get: get,
    isFilled: isFilled,
    bindAll: bindAll,
    RENDERERS: RENDERERS,
  };
})();
