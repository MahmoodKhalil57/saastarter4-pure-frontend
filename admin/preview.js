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

  var bodyHtml = "";
  var committed = { site: {}, landing: {}, catalog: {} };
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

  Promise.all([
    siteFetch("index.html").then(function (res) {
      return res.ok ? res.text() : "";
    }),
    jsonPart("site.json"),
    jsonPart("landing.json"),
    jsonPart("catalog.json"),
  ]).then(function (parts) {
    var doc = new DOMParser().parseFromString(parts[0], "text/html");
    doc.body.querySelectorAll("script").forEach(function (node) {
      node.remove();
    });
    bodyHtml = doc.body.innerHTML;
    committed.site = parts[1] || {};
    committed.landing = parts[2] || {};
    committed.catalog = parts[3] || {};
    ready = true;
    scheduleFlush();
  });

  /* --- painting ------------------------------------------------------------ */

  /** Where to scroll on first paint, so the edited data is on screen. */
  var FOCUS = { catalog: "#lots", landing: "#craft", site: ".banner" };

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
    // React's first commit clears the iframe body, so detect injection by
    // content, not by a marker: re-inject whenever the page isn't there.
    var firstPaint = !doc.querySelector("main");

    if (firstPaint) {
      doc.body.innerHTML = bodyHtml;
    }

    var content = {
      site: committed.site,
      landing: committed.landing,
      catalog: committed.catalog,
    };

    content[fileKey] = toPlain(props.entry && props.entry.get("data"));
    window.PureRender.bindAll(doc, content, { asset: assetResolver(props.getAsset) });

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

  window.CMS.registerPreviewTemplate("landing", sitePreview("landing"));
  window.CMS.registerPreviewTemplate("catalog", sitePreview("catalog"));
  window.CMS.registerPreviewTemplate("site", sitePreview("site"));

  // Console/debug access — lets you drive a preview by hand.
  window.PurePreview = { sitePreview: sitePreview };
})();
