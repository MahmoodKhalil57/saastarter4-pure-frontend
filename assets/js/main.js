/* ===========================================================================
   Qalam & Ahar — runtime enhancement
   No build step, and nothing here is load-bearing for reading the page: the
   words and the catalog are baked into index.html (by hand or by the visual
   builder in /admin/builder.html). This script only
     1. refreshes the data-driven lists and the announcement bar from
        /content/*.json, so a CMS edit shows up without re-saving the page,
     2. wires the sign-up form,
     3. adds the scroll-reveal motion.
   If a fetch fails — or JavaScript never runs — the baked-in page stands.
   Rendering logic lives in render.js (shared with the builder).
   =========================================================================== */

(function () {
  "use strict";

  // Opt in to JS-only styling (the scroll-reveal hide) only once this script
  // is actually running, so a blocked script can never strand content hidden.
  document.documentElement.classList.add("js");

  // Everything resolves against the directory the page is served from, so the
  // same files work at user.github.io/repo/ and at a custom domain root.
  var BASE = new URL(".", document.baseURI);

  /** Resolve a CMS media path (`/media/uploads/x.jpg`) against the site base. */
  function asset(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
    return new URL(String(path).replace(/^\/+/, ""), BASE).href;
  }

  var get = window.PureRender.get;
  var isFilled = window.PureRender.isFilled;

  function fetchJSON(name) {
    return fetch(new URL("content/" + name, BASE).href, { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error(name + ": HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        console.warn("[content]", err.message);
        return null;
      });
  }

  /* --- the notify form ---------------------------------------------------- */

  /**
   * Where a sign-up goes, in order of preference:
   *   1. the saastarter4-emdash backend, if this site has been told about one
   *   2. any third-party endpoint set in the CMS (Formspree and friends)
   *   3. the visitor's own mail app
   * This repo is public, so none of these can be a secret — the form id
   * identifies a form, it does not authorise anything.
   */
  function submitEndpoint(content) {
    var backend = get(content, "site.backend") || {};
    if (isFilled(backend.url) && isFilled(backend.form)) {
      return String(backend.url).replace(/\/+$/, "") + "/api/f/" + encodeURIComponent(backend.form);
    }
    var action = get(content, "landing.notify.form_action");
    return isFilled(action) ? action : "";
  }

  function applyForms(content) {
    var notify = get(content, "landing.notify") || {};
    var action = submitEndpoint(content);
    var mailto = get(content, "site.contact.email");
    var success = notify.success_note || "You are on the list. Watch your inbox.";

    document.querySelectorAll(".notify").forEach(function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();

        var input = form.querySelector('input[type="email"]');
        var status = form.querySelector(".notify__status");
        var email = input.value.trim();

        if (!input.checkValidity() || !email) {
          say(status, "That email address is not complete. Check it and try again.", "error");
          input.focus();
          return;
        }

        // No form endpoint configured yet: hand the visitor to their mail app
        // rather than silently dropping the address.
        if (!action) {
          if (!isFilled(mailto)) {
            say(status, "The list is not open yet. Try again shortly.", "error");
            return;
          }
          window.location.href =
            "mailto:" +
            mailto +
            "?subject=" +
            encodeURIComponent("Opening notice") +
            "&body=" +
            encodeURIComponent("Please add " + email + " to the list.");
          say(status, "Opening your mail app to finish.");
          return;
        }

        var button = form.querySelector("button[type='submit']");
        button.disabled = true;
        say(status, "Sending…");

        // Sent as FormData on purpose: multipart/form-data is a CORS-safe
        // content type, so the browser skips the preflight round trip that
        // application/json would force on every submission.
        fetch(action, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: new FormData(form),
        })
          .then(function (res) {
            return res.json().then(
              function (body) {
                return { ok: res.ok, body: body };
              },
              function () {
                return { ok: res.ok, body: {} };
              }
            );
          })
          .then(function (result) {
            // The backend reports per-field problems rather than a bare failure.
            var fieldError = (result.body.errors || [])[0];
            if (fieldError) {
              say(status, fieldError.message, "error");
              return;
            }
            if (!result.ok || result.body.success === false) {
              say(status, result.body.message || "That did not send. Try again.", "error");
              return;
            }
            form.reset();
            say(status, result.body.message || success);
          })
          .catch(function () {
            say(status, "That did not send. Try again, or email us directly.", "error");
          })
          .finally(function () {
            button.disabled = false;
          });
      });
    });
  }

  function say(node, message, state) {
    if (!node) return;
    node.textContent = message;
    if (state) {
      node.dataset.state = state;
    } else {
      delete node.dataset.state;
    }
  }

  /* --- scroll reveal ------------------------------------------------------ */

  function reveal(nodes) {
    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
      return;
    }

    // Anything still unobserved after a beat gets shown anyway, so a card can
    // never be stranded invisible (print, a stalled observer, a headless render).
    var failsafe = setTimeout(function () {
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
    }, 2500);

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10%" }
    );

    nodes.forEach(function (node) {
      observer.observe(node);
    });

    window.addEventListener("beforeprint", function () {
      clearTimeout(failsafe);
      nodes.forEach(function (node) {
        node.classList.add("is-revealed");
      });
    });
  }

  /* --- go ----------------------------------------------------------------- */

  Promise.all([fetchJSON("site.json"), fetchJSON("landing.json"), fetchJSON("catalog.json")]).then(
    function (parts) {
      var content = { site: parts[0] || {}, landing: parts[1] || {}, catalog: parts[2] || {} };
      window.PureRender.bindAll(document, content, { asset: asset });
      applyForms(content);

      var lots = document.querySelectorAll(".lot");
      lots.forEach(function (node, index) {
        node.style.setProperty("--reveal-delay", index * 70 + "ms");
      });
      reveal(lots);
    }
  );
})();
