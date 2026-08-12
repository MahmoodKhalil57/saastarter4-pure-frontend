/* ===========================================================================
   Qalam & Ahar — live CMS preview
   Replaces Sveltia's abstract field-by-field preview with the real page.

   How: Sveltia's Decap-compatible `CMS.registerPreviewTemplate()` renders a
   component into a sandboxed iframe and passes that iframe's `document` as a
   prop, re-invoking the component on every draft change. So the "React
   component" here is a plain function that returns null and paints the iframe
   itself: the site's body is injected once, then the same PureRender.bindAll
   the live page uses pours the draft content in — draft values for the file
   being edited, last-committed JSON for the other two. No React, no build.

   One rule keeps this honest: NEVER touch the DOM during the component call.
   React owns the iframe body as its root container; its first commit clears
   the container's children, and mutating it mid-render fights the reconciler.
   The component only records the latest request and schedules a paint with
   setTimeout(0), which lands after React has committed.

   Loaded by admin/index.html after sveltia-cms.js and ../assets/js/render.js.
   =========================================================================== */

(function () {
  "use strict";

  var SITE_BASE = new URL("..", location.href);
  var FONTS_URL =
    "https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400..700&display=swap";

  if (!window.CMS || !window.PureRender) {
    console.warn("[preview] CMS or PureRender missing — live preview disabled.");
    return;
  }

  // The preview iframe gets the same stylesheets as the page itself.
  [
    FONTS_URL,
    new URL("assets/css/styles.css", SITE_BASE).href,
    new URL("assets/css/page.css", SITE_BASE).href,
  ].forEach(function (url) {
    window.CMS.registerPreviewStyle(url);
  });

  /* --- the page, fetched once --------------------------------------------- */

  var bodyHtml = ""; // homepage body — the default preview surface
  var pageBodies = {}; // slug -> body html, for multi-page sites
  var committed = { symbolEntries: {} }; // content files land here by root name
  var ready = false;
  /** The latest paint request; painting is always deferred (see header). */
  var pending = null;
  var flushScheduled = false;

  function siteFetch(path) {
    return fetch(new URL(path, SITE_BASE).href, { cache: "no-cache" });
  }

  function jsonPart(name) {
    return siteFetch("content/" + name)
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function stripBody(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    doc.body.querySelectorAll("script").forEach(function (node) {
      node.remove();
    });
    return doc.body.innerHTML;
  }

  // Content files are discovered from the bindings: site and pages always,
  // plus whatever roots the symbols' Content sources name.
  Promise.all([
    siteFetch("index.html").then(function (res) {
      return res.ok ? res.text() : "";
    }),
    jsonPart("symbols.json"),
  ])
    .then(function (parts) {
      bodyHtml = stripBody(parts[0]);
      pageBodies.index = bodyHtml;

      var roots = { site: true, pages: true };
      (((parts[1] || {}).symbols) || []).forEach(function (entry) {
        if (!entry || !entry.id) return;
        committed.symbolEntries[entry.id] = entry;
        if (entry.source) roots[String(entry.source).split(".")[0]] = true;
      });

      var names = Object.keys(roots);
      return Promise.all(
        names.map(function (name) {
          return jsonPart(name + ".json");
        })
      ).then(function (files) {
        names.forEach(function (name, index) {
          committed[name] = files[index] || {};
        });
      });
    })
    .then(function () {

      // Multi-page sites: fetch the other exported pages, so the preview can
      // show whichever page actually holds the data being edited.
      var others = (committed.pages.pages || []).filter(function (page) {
        return page.slug && page.slug !== "index";
      });
      return Promise.all(
        others
          .map(function (page) {
            return siteFetch(page.slug + ".html")
              .then(function (res) {
                return res.ok ? res.text() : null;
              })
              .then(function (html) {
                if (html) pageBodies[page.slug] = stripBody(html);
              })
              .catch(function () {
                /* not exported yet */
              });
          })
          .concat([loadProjectSymbols()])
      );
    })
    .then(function () {
      ready = true;
      scheduleFlush();
    });

  /* --- the symbol stage --------------------------------------------------------
     Symbol entries get a component workbench, not a field dump: the drawing
     rendered alone, centered on the site's real styles. The markup comes from
     an instance on any exported page; a drawn-but-unplaced symbol falls back
     to reconstructing the drawing from the builder's project file. */

  var projectSymbolHtml = {}; // id -> html, reconstructed from page.grapes.json

  function componentToHtml(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (node.type === "textnode" || node.type === "comment") return node.content || "";

    var VOID = { img: 1, input: 1, br: 1, hr: 1, source: 1, embed: 1 };
    var tag = node.tagName || "div";
    var attrs = Object.assign({}, node.attributes);
    var classes = (node.classes || [])
      .map(function (cls) {
        return typeof cls === "string" ? cls : cls.name;
      })
      .filter(Boolean);
    if (classes.length) attrs.class = classes.join(" ");

    var open =
      "<" +
      tag +
      Object.keys(attrs)
        .map(function (key) {
          var value = attrs[key];
          if (value === true || value === "") return " " + key;
          return " " + key + '="' + String(value).replace(/"/g, "&quot;") + '"';
        })
        .join("");

    if (VOID[tag]) return open + " />";
    var children = (node.components || []).map(componentToHtml).join("");
    if (!children && node.content) children = node.content;
    return open + ">" + children + "</" + tag + ">";
  }

  function loadProjectSymbols() {
    return jsonPart("page.grapes.json").then(function (project) {
      ((project || {}).symbols || []).forEach(function (main) {
        var id = (main.attributes || {})["data-symbol"];
        if (id) projectSymbolHtml[id] = componentToHtml(main);
      });
    });
  }

  function symbolHtml(id) {
    if (!id) return "";
    var marker = 'data-symbol="' + id + '"';
    var slugs = Object.keys(pageBodies);

    for (var i = 0; i < slugs.length; i += 1) {
      if (pageBodies[slugs[i]].indexOf(marker) !== -1) {
        var doc = new DOMParser().parseFromString(pageBodies[slugs[i]], "text/html");
        var el = doc.querySelector('[data-symbol="' + id + '"]');
        if (el) return el.outerHTML;
      }
    }
    return projectSymbolHtml[id] || "";
  }

  var STAGE_CSS =
    ".symbol-stage { min-height: 100vh; display: grid; place-items: center; " +
    "padding: 3rem 2rem; box-sizing: border-box; } " +
    ".symbol-stage > * { width: 100%; max-width: 34rem; } " +
    ".symbol-stage__empty { font: 0.9rem/1.6 system-ui, sans-serif; opacity: 0.7; " +
    "text-align: center; }";

  function applySymbolStage(doc, draft) {
    var html = symbolHtml(draft.id);
    var fingerprint =
      (draft.id || "") + ":" + html.length + ":" + JSON.stringify(draft.items || "").length;
    if (doc.body.getAttribute("data-symbol-stage") === fingerprint) return;

    if (!doc.getElementById("symbol-stage-style")) {
      var style = doc.createElement("style");
      style.id = "symbol-stage-style";
      style.textContent = STAGE_CSS;
      doc.head.appendChild(style);
    }

    doc.body.innerHTML =
      '<div class="symbol-stage">' +
      (html ||
        '<p class="symbol-stage__empty">Not drawn yet — open the builder, draw this element' +
        " (or select one and use “Make reusable”), and place it on a page.</p>") +
      "</div>";
    doc.body.setAttribute("data-symbol-stage", fingerprint);

    // The symbol's content renders live from the draft — its own items, or
    // its Content source resolved against the committed files.
    if (html && draft.id) {
      var entries = Object.assign({}, committed.symbolEntries);
      entries[draft.id] = draft;
      window.PureRender.bindAll(
        doc,
        Object.assign({}, committed, { symbolEntries: entries }),
        {}
      );
    }
  }

  /** Pick the page whose markup holds the data the current file feeds. */
  function bodyFor(fileKey) {
    var hint = 'data-list="' + fileKey + ".";
    var slugs = Object.keys(pageBodies);

    for (var i = 0; i < slugs.length; i += 1) {
      if (pageBodies[slugs[i]].indexOf(hint) !== -1) {
        return { slug: slugs[i], html: pageBodies[slugs[i]] };
      }
    }
    return { slug: "index", html: bodyHtml };
  }

  /* --- painting ------------------------------------------------------------ */

  /** Where to scroll on first paint, so the edited data is on screen. */
  var FOCUS = {
    catalog: "#lots",
    craft: "#craft",
    questions: "#questions",
    site: ".banner",
    pages: ".masthead",
  };

  /** The last painted preview, so field focus can steer it (see below). */
  var active = null;

  function toPlain(value) {
    return value && typeof value.toJS === "function" ? value.toJS() : value || {};
  }

  /** Resolve a media path: Sveltia's getAsset covers not-yet-committed uploads
      (blob URLs); anything else resolves against the site base. */
  function assetResolver(getAsset) {
    return function (path) {
      if (!path) return "";
      var url = String(path);
      try {
        var proxy = getAsset && getAsset(url);
        if (proxy && proxy.url) url = String(proxy.url);
      } catch (error) {
        /* fall through to plain resolution */
      }
      if (/^(https?:|blob:|data:)/.test(url) || url.startsWith("//")) return url;
      return new URL(url.replace(/^\/+/, ""), SITE_BASE).href;
    };
  }

  function apply(doc, fileKey, props) {
    var draft = toPlain(props.entry && props.entry.get("data"));

    if (fileKey === "symbols") {
      applySymbolStage(doc, draft);
      return;
    }

    var chosen;

    if (fileKey === "pages") {
      // Pages is a folder collection: the draft is ONE page entry. Show that
      // page if it has been exported, and preview the menu with the draft
      // merged into the committed list.
      chosen =
        draft.slug && pageBodies[draft.slug]
          ? { slug: draft.slug, html: pageBodies[draft.slug] }
          : { slug: "index", html: bodyHtml };
    } else {
      chosen = bodyFor(fileKey);
    }
    // React's first commit clears the iframe body, so detect injection by
    // content, not by a marker — and re-inject when the right page changes.
    var firstPaint =
      !doc.querySelector("main") || doc.body.getAttribute("data-preview-src") !== chosen.slug;

    if (firstPaint) {
      doc.body.innerHTML = chosen.html;
      doc.body.setAttribute("data-preview-src", chosen.slug);
    }

    var content = Object.assign({}, committed);

    if (fileKey === "pages") {
      var list = ((committed.pages || {}).pages || []).slice();
      var at = list.findIndex(function (page) {
        return page.slug === draft.slug;
      });
      if (at === -1) list.push(draft);
      else list[at] = draft;
      content.pages = { pages: list };
    } else {
      content[fileKey] = draft;
    }
    window.PureRender.bindAll(doc, content, { asset: assetResolver(props.getAsset) });
    active = { doc: doc, fileKey: fileKey };

    if (firstPaint && FOCUS[fileKey]) {
      var target = doc.querySelector(FOCUS[fileKey]);
      if (target) target.scrollIntoView();
    }
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(function () {
      flushScheduled = false;
      if (!ready || !pending || !bodyHtml) return;
      var request = pending;
      try {
        apply(request.doc, request.fileKey, request.props);
        pending = null;
      } catch (error) {
        console.warn("[preview]", error);
      }
    }, 0);
  }

  /* --- follow the editor's focus ----------------------------------------------
     Every Sveltia field editor is wrapped in a light-DOM section carrying
     data-key-path (e.g. "items.2.title"). Focusing any field bubbles a
     focusin event out of the shadow DOM, so clicking into a field steers the
     preview to the exact element that field feeds — the third catalog card,
     the second question — and flashes it. */

  /** Map a field key path to the element it feeds. Order matters: most
      specific first. `m` is the regex match; index groups are item indexes. */
  var TARGET_RULES = {
    catalog: [
      [/^items\.(\d+)/, byIndex(".lot-grid .lot", "#lots")],
      [/^items/, bySelector("#lots")],
    ],
    craft: [
      [/^steps\.(\d+)/, byIndex(".steps .step", "#craft")],
      [/^steps/, bySelector("#craft")],
    ],
    questions: [
      [/^items\.(\d+)/, byIndex(".faq details", "#questions")],
      [/^items/, bySelector("#questions")],
    ],
    site: [
      [/^announcement/, bySelector(".banner")],
      [/^contact\.links/, bySelector(".colophon__links")],
      [/^contact/, bySelector(".colophon")],
      [/^backend/, bySelector("#notify")],
    ],
    // Folder collection: key paths are entry fields (slug, title, nav_label…).
    pages: [[/^/, bySelector(".masthead__nav")]],
  };

  function bySelector(selector) {
    return function (doc) {
      return doc.querySelector(selector);
    };
  }

  function byIndex(itemSelector, fallback) {
    return function (doc, m) {
      return doc.querySelectorAll(itemSelector)[Number(m[1])] || doc.querySelector(fallback);
    };
  }

  var FLASH_CSS =
    ".preview-flash { outline: 2px solid #b3552e; outline-offset: 5px; " +
    "transition: outline-color 0.4s ease; } " +
    ".preview-flash.preview-flash--fade { outline-color: transparent; }";
  var flashTimers = [];

  function flash(doc, el) {
    if (!doc.getElementById("preview-flash-style")) {
      var style = doc.createElement("style");
      style.id = "preview-flash-style";
      style.textContent = FLASH_CSS;
      doc.head.appendChild(style);
    }
    flashTimers.forEach(clearTimeout);
    flashTimers = [];
    doc.querySelectorAll(".preview-flash").forEach(function (node) {
      node.classList.remove("preview-flash", "preview-flash--fade");
    });
    el.classList.add("preview-flash");
    flashTimers.push(
      setTimeout(function () {
        el.classList.add("preview-flash--fade");
      }, 900),
      setTimeout(function () {
        el.classList.remove("preview-flash", "preview-flash--fade");
      }, 1400)
    );
  }

  function steerPreview(keyPath) {
    if (!active || !active.doc.defaultView) return;
    var rules = TARGET_RULES[active.fileKey] || [];

    for (var i = 0; i < rules.length; i += 1) {
      var m = keyPath.match(rules[i][0]);

      if (m) {
        var el = rules[i][1](active.doc, m);

        if (el && !el.hidden) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          flash(active.doc, el);
        }
        return;
      }
    }
  }

  document.addEventListener("focusin", function (event) {
    var path = event.composedPath ? event.composedPath() : [event.target];

    for (var i = 0; i < path.length; i += 1) {
      var el = path[i];

      if (el && el.dataset && el.dataset.keyPath) {
        steerPreview(el.dataset.keyPath);
        return;
      }
    }
  });

  /* --- registration --------------------------------------------------------- */

  /** One template per CMS file. Each returns null and never touches the DOM
      synchronously — it records the request and lets scheduleFlush paint
      after React's commit. */
  function sitePreview(fileKey) {
    return function SitePreview(props) {
      if (props.document) {
        pending = { doc: props.document, fileKey: fileKey, props: props };
        scheduleFlush();
      }

      return null;
    };
  }

  window.CMS.registerPreviewTemplate("catalog", sitePreview("catalog"));
  window.CMS.registerPreviewTemplate("craft", sitePreview("craft"));
  window.CMS.registerPreviewTemplate("questions", sitePreview("questions"));
  window.CMS.registerPreviewTemplate("site", sitePreview("site"));
  // Editing Pages previews the menu live (nav renders from the draft list).
  window.CMS.registerPreviewTemplate("pages", sitePreview("pages"));
  // Symbol entries preview the component itself, staged in isolation on the
  // site's real styles — a story, not a field list.
  window.CMS.registerPreviewTemplate("symbols", sitePreview("symbols"));

  // Console/debug access — lets you drive a preview by hand.
  window.PurePreview = { sitePreview: sitePreview };
})();
