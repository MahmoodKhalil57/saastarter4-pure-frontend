/* ===========================================================================
   Qalam & Ahar — content loader
   No build step. The page ships with real copy baked into index.html; this
   script replaces it with whatever the CMS last committed to /content.
   If a fetch fails, the baked-in copy stays and the page still works.
   =========================================================================== */

(function () {
  "use strict";

  // Everything resolves against the directory the page is served from, so the
  // same files work at user.github.io/repo/ and at a custom domain root.
  var BASE = new URL(".", document.baseURI);

  /** Resolve a CMS media path (`/media/uploads/x.jpg`) against the site base. */
  function asset(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
    return new URL(String(path).replace(/^\/+/, ""), BASE).href;
  }

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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

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

  /* --- renderers ---------------------------------------------------------- */

  function renderLots(container, items) {
    container.replaceChildren();

    items.forEach(function (item, index) {
      var li = el("li", "lot");
      li.style.setProperty("--reveal-delay", index * 70 + "ms");

      var figure = el("figure", "lot__figure");
      if (isFilled(item.image)) {
        var img = el("img");
        img.src = asset(item.image);
        img.alt = item.image_alt || item.title || "";
        img.loading = "lazy";
        figure.appendChild(img);
      } else {
        figure.classList.add("lot__figure--empty");
      }
      li.appendChild(figure);

      var meta = el("p", "lot__meta");
      meta.appendChild(el("span", null, item.lot ? "Lot " + item.lot : ""));
      if (isFilled(item.status)) meta.appendChild(el("span", "lot__status", item.status));
      li.appendChild(meta);

      li.appendChild(el("h3", "lot__title", item.title || ""));
      if (isFilled(item.blurb)) li.appendChild(el("p", "lot__blurb", item.blurb));
      if (isFilled(item.price)) li.appendChild(el("p", "lot__price", item.price));

      container.appendChild(li);
    });

    reveal(container.querySelectorAll(".lot"));
  }

  function renderSteps(container, items) {
    container.replaceChildren();

    items.forEach(function (item) {
      var li = el("li", "step");
      li.appendChild(el("h3", "step__title", item.title || ""));
      if (isFilled(item.body)) li.appendChild(el("p", "step__body", item.body));
      container.appendChild(li);
    });
  }

  function renderFaq(container, items) {
    container.replaceChildren();

    items.forEach(function (item) {
      var details = document.createElement("details");
      var summary = el("summary", null, item.question || "");
      details.appendChild(summary);
      details.appendChild(el("p", null, item.answer || ""));
      container.appendChild(details);
    });
  }

  function renderLinks(container, items) {
    container.replaceChildren();

    items.forEach(function (item) {
      if (!isFilled(item.url) || !isFilled(item.label)) return;
      var li = el("li");
      var a = el("a", null, item.label);
      a.href = item.url;
      if (/^https?:/.test(item.url)) {
        a.rel = "noopener";
        a.target = "_blank";
      }
      li.appendChild(a);
      container.appendChild(li);
    });
  }

  var LIST_RENDERERS = {
    "catalog.items": renderLots,
    "landing.craft.steps": renderSteps,
    "landing.faq.items": renderFaq,
    "site.contact.links": renderLinks,
  };

  /* --- binding ------------------------------------------------------------ */

  function bind(content) {
    document.querySelectorAll("[data-text]").forEach(function (node) {
      var value = get(content, node.dataset.text);
      if (isFilled(value)) node.textContent = value;
    });

    document.querySelectorAll("[data-when]").forEach(function (node) {
      node.hidden = !isFilled(get(content, node.dataset.when));
    });

    document.querySelectorAll("[data-list]").forEach(function (node) {
      var path = node.dataset.list;
      var items = get(content, path);
      var render = LIST_RENDERERS[path];
      if (render && Array.isArray(items) && items.length) render(node, items);
    });

    applyHead(content);
    applyForms(content);
  }

  function applyHead(content) {
    var seo = get(content, "site.seo") || {};
    var title = seo.title || get(content, "site.brand.name_latin");
    if (isFilled(title)) {
      document.title = title;
      setMeta("property", "og:title", title);
    }
    if (isFilled(seo.description)) {
      setMeta("name", "description", seo.description);
      setMeta("property", "og:description", seo.description);
    }
    if (isFilled(seo.share_image)) setMeta("property", "og:image", asset(seo.share_image));
  }

  function setMeta(attr, key, value) {
    var tag = document.head.querySelector("meta[" + attr + '="' + key + '"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute(attr, key);
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", value);
  }

  /* --- the notify form ---------------------------------------------------- */

  function applyForms(content) {
    var notify = get(content, "landing.notify") || {};
    var action = isFilled(notify.form_action) ? notify.form_action : "";
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

        fetch(action, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: new FormData(form),
        })
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            form.reset();
            say(status, success);
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
      bind({ site: parts[0] || {}, landing: parts[1] || {}, catalog: parts[2] || {} });
    }
  );
})();
