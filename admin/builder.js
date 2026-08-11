/* ===========================================================================
   Qalam & Ahar — visual page builder
   GrapesJS (pinned from a CDN, like Sveltia) composing the real site.
   No build step anywhere; this file is the whole integration.

   The ownership model, which everything below follows — Sveltia owns what
   things ARE; the builder owns what they LOOK like:

     content/pages.json          Sveltia-created. The list of pages (slug,
                                 title, description, menu label). The builder
                                 composes each one and exports <slug>.html;
                                 it cannot create or delete pages.
     content/symbols.json        Sveltia-bound. The symbol registry: id, name,
                                 and the backend binding (none | form). The
                                 builder draws symbol bodies and places
                                 instances; bindings are stamped at export.
     content/page.grapes.json    the editor's project file — SOURCE OF TRUTH
                                 for every page body and symbol drawing. The
                                 editor loads this, never re-parses HTML
                                 (except once, to seed the first page).
     <slug>.html                 compiled artifacts, re-exported every save:
                                 head = shared shell + the page's Sveltia
                                 title/description, body = the drawing, CMS
                                 data baked in so pages read without JS.
     assets/css/page.css         styles authored in the editor (all pages).
     content/blocks.grapes.json  designer-made starter blocks (copies).
     content/*.json              Sveltia-owned data, locked in the canvas,
                                 re-baked fresh into every export.

   Saving writes everything in ONE commit (GitHub git-data API) or one pass
   to a local folder (File System Access API), so the repo never holds a page
   whose project file and exports disagree.
   =========================================================================== */

(function () {
  "use strict";

  var SITE_BASE = new URL("..", location.href);
  var PROJECT_PATH = "content/page.grapes.json";
  var PAGES_PATH = "content/pages.json";
  var SYMBOLS_PATH = "content/symbols.json";
  var BLOCKS_PATH = "content/blocks.grapes.json";
  var PAGE_CSS_PATH = "assets/css/page.css";
  var TOKEN_KEY = "pure-builder.github-token";
  var SVELTIA_USER_KEY = "sveltia-cms.user";
  var FONTS_URL =
    "https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400..700&display=swap";
  var PAGE_CSS_HEADER =
    "/* Written by the visual builder (admin/builder.html).\n" +
    "   Hand edits here are overwritten on the next builder save — put\n" +
    "   hand-written styles in styles.css instead. */\n";

  var ui = {
    status: document.getElementById("status"),
    save: document.getElementById("save"),
    saveBlock: document.getElementById("save-block"),
    makeSymbol: document.getElementById("make-symbol"),
    pageSelect: document.getElementById("page-select"),
    local: document.getElementById("connect-local"),
    github: document.getElementById("connect-github"),
  };

  var state = {
    editor: null,
    content: null, // { site, landing, catalog, pages }
    pages: [], // declared pages from content/pages.json
    symbols: [], // symbol registry from content/symbols.json
    newSymbolIds: [], // registry rows minted in this session ("Make reusable")
    mode: null, // "github" | "local"
    repo: null, // "owner/name", from config.yml
    branch: "master",
    token: localStorage.getItem(TOKEN_KEY) || "",
    dirHandle: null,
    customBlocks: [], // designer-made blocks, persisted in content/blocks.grapes.json
    hadBlocksFile: false,
  };

  function status(message, isError) {
    ui.status.textContent = message;
    if (isError) {
      ui.status.dataset.state = "error";
      console.error("[builder]", message);
    } else {
      delete ui.status.dataset.state;
    }
  }

  /* --- one sign-in for both editors -------------------------------------------
     Sveltia keeps its signed-in user (token included) in localStorage under
     `sveltia-cms.user`. Anyone who can push can use both tools, so the builder
     reads that token first and, when it collects one itself, leaves it where
     Sveltia will find it. Sign in to either editor once and both work. */

  function sveltiaToken() {
    try {
      var user = JSON.parse(localStorage.getItem(SVELTIA_USER_KEY) || "null");
      return user && typeof user.token === "string" ? user.token : "";
    } catch (error) {
      return "";
    }
  }

  function shareTokenWithSveltia(token) {
    try {
      if (!localStorage.getItem(SVELTIA_USER_KEY)) {
        localStorage.setItem(
          SVELTIA_USER_KEY,
          JSON.stringify({ backendName: "github", token: token })
        );
      }
    } catch (error) {
      /* sharing is best-effort */
    }
  }

  /* --- asset path forms ----------------------------------------------------
     The CMS stores media as `/media/uploads/x.jpg`. The canvas needs a full
     URL; exported pages want a relative path so they work both at
     user.github.io/repo/ and at a custom-domain root. */

  function canvasAsset(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
    return new URL(String(path).replace(/^\/+/, ""), SITE_BASE).href;
  }

  function bakedAsset(path) {
    if (!path) return "";
    if (/^(https?:)?\/\//.test(path) || path.startsWith("data:")) return path;
    return String(path).replace(/^\/+/, "");
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  /* --- loading ------------------------------------------------------------ */

  function siteFetch(path) {
    return fetch(new URL(path, SITE_BASE).href, { cache: "no-cache" });
  }

  function fetchJSON(path) {
    return siteFetch(path)
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function loadContent() {
    return Promise.all([
      fetchJSON("content/site.json"),
      fetchJSON("content/landing.json"),
      fetchJSON("content/catalog.json"),
      fetchJSON(PAGES_PATH),
    ]).then(function (parts) {
      return {
        site: parts[0] || {},
        landing: parts[1] || {},
        catalog: parts[2] || {},
        pages: parts[3] || {},
      };
    });
  }

  function loadConfig() {
    return siteFetch("admin/config.yml")
      .then(function (res) {
        return res.ok ? res.text() : "";
      })
      .catch(function () {
        return "";
      })
      .then(function (text) {
        var repo = /^\s*repo:\s*([^\s#]+)/m.exec(text);
        var branch = /^\s*branch:\s*([^\s#]+)/m.exec(text);
        if (repo) state.repo = repo[1];
        if (branch) state.branch = branch[1];
      });
  }

  /** The one-time import: only runs while content/page.grapes.json does not
      exist yet. After the first save the project file is the source of truth
      and the HTML is never parsed into the editor again. */
  function loadSeedHtml() {
    return siteFetch("index.html")
      .then(function (res) {
        if (!res.ok) throw new Error("index.html: HTTP " + res.status);
        return res.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        doc.body.querySelectorAll("script").forEach(function (node) {
          node.remove();
        });
        return doc.body.innerHTML;
      });
  }

  /* --- pages -------------------------------------------------------------------
     Sveltia creates pages (content/pages.json); the builder composes them.
     Declared pages are synced into the GrapesJS Pages module — missing ones
     start empty — and each one exports to <slug>.html on save. */

  function declaredPages() {
    return Array.isArray(state.pages) && state.pages.length
      ? state.pages
      : [{ slug: "index", title: "", description: "" }];
  }

  function findProjectPage(slug) {
    return state.editor.Pages.getAll().find(function (page) {
      return page.get("name") === slug;
    });
  }

  function syncPages() {
    var editor = state.editor;
    var pages = declaredPages();

    // Legacy projects have one unnamed page: that is the homepage.
    if (!findProjectPage("index")) {
      var main = editor.Pages.getMain();
      if (main && !main.get("name")) main.set("name", "index");
    }

    pages.forEach(function (decl) {
      if (!findProjectPage(decl.slug)) {
        editor.Pages.add({ name: decl.slug, component: "" });
      }
    });

    var undeclared = editor.Pages.getAll().filter(function (page) {
      return !pages.some(function (decl) {
        return decl.slug === page.get("name");
      });
    });
    if (undeclared.length) {
      console.warn(
        "[builder] drawings exist for pages no longer declared in content/pages.json:",
        undeclared.map(function (page) {
          return page.get("name");
        })
      );
    }

    renderPageSelect();
  }

  function renderPageSelect() {
    var selected = state.editor.Pages.getSelected();
    ui.pageSelect.replaceChildren();

    declaredPages().forEach(function (decl) {
      var option = document.createElement("option");
      option.value = decl.slug;
      option.textContent = decl.slug === "index" ? "index (home)" : decl.slug;
      if (selected && selected.get("name") === decl.slug) option.selected = true;
      ui.pageSelect.appendChild(option);
    });
    ui.pageSelect.hidden = declaredPages().length < 2;
  }

  function switchPage() {
    var page = findProjectPage(ui.pageSelect.value);
    if (page) state.editor.Pages.select(page);
  }

  /* --- symbols -------------------------------------------------------------------
     Two layers. Sveltia owns what a symbol IS (content/symbols.json: id, name,
     backend binding); the builder owns what it LOOKS like (a real GrapesJS
     symbol in the project, root tagged data-symbol=<id>, instances synced
     across pages by the editor). Declared-but-undrawn symbols appear as stubs
     to fill in; "Make reusable" mints a registry row for a drawn one. */

  function symbolMains() {
    var map = {};
    state.editor.Components.getSymbols().forEach(function (main) {
      var id = main.getAttributes()["data-symbol"];
      if (id) map[id] = main;
    });
    return map;
  }

  function addSymbolBlock(entry) {
    var blockId = "symbol-" + entry.id;
    if (!state.editor.BlockManager.get(blockId)) {
      state.editor.BlockManager.add(blockId, {
        label: entry.name || entry.id,
        category: "Reusable",
        content: '<div data-symbol-ref="' + entry.id + '"></div>',
      });
    }
  }

  function syncSymbols() {
    var editor = state.editor;
    var mains = symbolMains();

    state.symbols.forEach(function (entry) {
      if (!mains[entry.id]) {
        // Declared in Sveltia but not drawn yet: create a stub to fill in.
        var wrapper = editor.Pages.getSelected().getMainComponent();
        var stub = wrapper.append(
          '<section data-symbol="' +
            escapeHtml(entry.id) +
            '"><p>' +
            escapeHtml(entry.name || entry.id) +
            " — draw this reusable element, then delete this note.</p></section>"
        )[0];
        // addSymbol converts the stub into an instance and returns the MAIN,
        // which lives in the project's symbol store. Keep the main; drop the
        // auto-placed canvas instance — the designer places instances from
        // the "Reusable" block category when ready.
        editor.Components.addSymbol(stub);
        stub.remove();
        mains = symbolMains();
      }
      addSymbolBlock(entry);
    });

    // Drawings whose registry row disappeared (deleted in Sveltia) or that
    // predate the registry: surface them so nothing is silently lost.
    Object.keys(mains).forEach(function (id) {
      var declared = state.symbols.some(function (entry) {
        return entry.id === id;
      });
      if (!declared) {
        state.symbols.push({ id: id, name: id, binding: { type: "none" } });
        state.newSymbolIds.push(id);
        addSymbolBlock({ id: id, name: id });
      }
    });

    editor.UndoManager.clear();
  }

  function makeSymbol() {
    var editor = state.editor;
    var selected = editor && editor.getSelected();
    if (!selected) {
      status("Select the element to make reusable first.", true);
      return;
    }
    var info = editor.Components.getSymbolInfo(selected);
    if (info && info.isSymbol) {
      status("That is already a reusable element.", true);
      return;
    }
    var name = window.prompt("Name this reusable element:");
    if (!name) return;
    var id = slugify(name);
    if (!id || state.symbols.some(function (entry) { return entry.id === id; })) {
      status("A reusable element with that name already exists.", true);
      return;
    }

    selected.addAttributes({ "data-symbol": id });
    editor.Components.addSymbol(selected);

    var entry = { id: id, name: name, binding: { type: "none" } };
    state.symbols.push(entry);
    state.newSymbolIds.push(id);
    addSymbolBlock(entry);
    status(
      "“" + name + "” is reusable — place copies from the block panel; edits sync everywhere. " +
        "Bind it to the backend in the CMS under Structure → Symbols."
    );
  }

  /** Dropping a "Reusable" block plants a placeholder; swap it for a real
      linked instance of the symbol. */
  function handleSymbolDrop(component) {
    if (!component || typeof component.getAttributes !== "function") return;
    var id = component.getAttributes()["data-symbol-ref"];
    if (!id) return;

    var main = symbolMains()[id];
    var parent = component.parent();
    var at = component.index();
    component.remove();
    if (!main || !parent) return;

    var instance = state.editor.Components.addSymbol(main);
    if (instance) parent.append(instance, { at: at });
  }

  /** Re-read the registry from the backend at save time and merge: Sveltia is
      the authority on existing rows (names, bindings); the builder may only
      add rows it minted this session. A binding set in the CMS can never be
      clobbered by a stale builder save. */
  function mergeSymbolRegistry() {
    return readBackendFile(SYMBOLS_PATH)
      .then(function (text) {
        var fresh = [];
        try {
          fresh = (JSON.parse(text) || {}).symbols || [];
        } catch (error) {
          /* missing or malformed file — treat as empty */
        }
        var merged = fresh.slice();
        state.symbols.forEach(function (entry) {
          var known = fresh.some(function (row) {
            return row.id === entry.id;
          });
          if (!known && state.newSymbolIds.indexOf(entry.id) !== -1) {
            merged.push(entry);
          }
        });
        state.symbols = merged;
        return merged;
      })
      .catch(function () {
        return state.symbols;
      });
  }

  /** Stamp backend bindings onto exported markup: a form-bound symbol's form
      gets data-form (wired by main.js at runtime) and, when the backend URL is
      known, a native action so the form submits even without JavaScript. */
  function stampBindings(doc) {
    doc.querySelectorAll("[data-symbol]").forEach(function (el) {
      var entry = state.symbols.find(function (row) {
        return row.id === el.getAttribute("data-symbol");
      });
      var binding = entry && entry.binding;
      if (!binding || binding.type !== "form") return;

      var form = el.matches("form") ? el : el.querySelector("form");
      if (!form) return;

      form.setAttribute("data-form", binding.form || "");
      var backend = (state.content.site || {}).backend || {};
      if (backend.url && binding.form) {
        form.setAttribute("method", "post");
        form.setAttribute(
          "action",
          String(backend.url).replace(/\/+$/, "") + "/api/f/" + encodeURIComponent(binding.form)
        );
      }
    });
  }

  /* --- canvas baking --------------------------------------------------------
     CMS-owned regions (data-list / data-text / data-when) are rendered into
     every page's drawing so editing is WYSIWYG, then locked: they are edited
     in the CMS, and every export re-renders them from fresh JSON anyway. */

  function lockDeep(cmp) {
    cmp.set({
      editable: false,
      selectable: false,
      hoverable: false,
      draggable: false,
      removable: false,
      copyable: false,
      badgable: false,
      highlightable: false,
      layerable: false,
    });
    cmp.components().forEach(lockDeep);
  }

  function bakeCanvas() {
    var content = state.content;

    state.editor.Pages.getAll().forEach(function (page) {
      var root = page.getMainComponent();

      root.find("[data-list]").forEach(function (cmp) {
        var path = cmp.getAttributes()["data-list"];
        var items = window.PureRender.get(content, path);
        var render = window.PureRender.RENDERERS[path];
        if (!render || !Array.isArray(items) || !items.length) return;

        var holder = document.createElement(cmp.get("tagName") || "div");
        render(holder, items, { asset: canvasAsset });
        cmp.set({ droppable: false });
        cmp.components(holder.innerHTML);
        cmp.components().forEach(lockDeep);
      });

      root.find("[data-text]").forEach(function (cmp) {
        var value = window.PureRender.get(content, cmp.getAttributes()["data-text"]);
        if (!window.PureRender.isFilled(value)) return;
        cmp.components(escapeHtml(value));
        cmp.set({ editable: false });
        cmp.components().forEach(lockDeep);
      });

      root.find("[data-when]").forEach(function (cmp) {
        if (
          window.PureRender.isFilled(
            window.PureRender.get(content, cmp.getAttributes()["data-when"])
          )
        ) {
          cmp.removeAttributes("hidden");
        } else {
          cmp.addAttributes({ hidden: "" });
        }
      });
    });

    // Baking is bookkeeping, not a user edit — keep it out of undo history.
    state.editor.UndoManager.clear();
  }

  /* --- export ----------------------------------------------------------------
     <slug>.html = head of the page's current file (or the homepage's, for new
     pages) with the page's Sveltia title/description applied + the drawing +
     freshly baked CMS data + the site's script tags. */

  function readBackendFile(path) {
    if (state.mode === "local" && state.dirHandle) {
      var parts = path.split("/");
      var walk = Promise.resolve(state.dirHandle);
      parts.slice(0, -1).forEach(function (part) {
        walk = walk.then(function (dir) {
          return dir.getDirectoryHandle(part);
        });
      });
      return walk
        .then(function (dir) {
          return dir.getFileHandle(parts[parts.length - 1]);
        })
        .then(function (handle) {
          return handle.getFile();
        })
        .then(function (file) {
          return file.text();
        });
    }
    if (state.mode === "github") {
      return ghFetch("/contents/" + path + "?ref=" + encodeURIComponent(state.branch), {
        accept: "application/vnd.github.raw+json",
        raw: true,
      });
    }
    return siteFetch(path).then(function (res) {
      if (!res.ok) throw new Error(path + ": HTTP " + res.status);
      return res.text();
    });
  }

  function buildPageHtml(shellHtml, decl, pageComponent) {
    var doc = new DOMParser().parseFromString(shellHtml, "text/html");

    // The scripts belong to the site, not to the editor: carry them over.
    var scripts = Array.prototype.slice.call(doc.body.querySelectorAll("script"));
    doc.body.innerHTML = state.editor.getHtml({ component: pageComponent });
    scripts.forEach(function (node) {
      doc.body.appendChild(node);
    });

    // The page's identity comes from its Sveltia entry.
    if (window.PureRender.isFilled(decl.title)) {
      doc.title = decl.title;
      setMeta(doc, "property", "og:title", decl.title);
    }
    if (window.PureRender.isFilled(decl.description)) {
      setMeta(doc, "name", "description", decl.description);
      setMeta(doc, "property", "og:description", decl.description);
    }

    // Bake current CMS data so the page reads complete without JavaScript.
    window.PureRender.bindAll(doc, state.content, { asset: bakedAsset });
    stampBindings(doc);

    // The editor's stylesheet must be linked; add the line if it is missing.
    if (!doc.head.querySelector('link[href$="page.css"]')) {
      var link = doc.createElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("href", PAGE_CSS_PATH);
      doc.head.appendChild(link);
    }

    return "<!doctype html>\n" + doc.documentElement.outerHTML + "\n";
  }

  function setMeta(doc, attr, key, value) {
    var tag = doc.head.querySelector("meta[" + attr + '="' + key + '"]');
    if (!tag) {
      tag = doc.createElement("meta");
      tag.setAttribute(attr, key);
      doc.head.appendChild(tag);
    }
    tag.setAttribute("content", value);
  }

  /** Assemble every file a save writes. Also used headless (PureBuilder) so
      the export pipeline is testable without a backend. */
  function collectFiles() {
    return loadContent()
      .then(function (content) {
        state.content = content;
        state.pages = (content.pages || {}).pages || state.pages;
        syncPages();
        bakeCanvas();
        return mergeSymbolRegistry();
      })
      .then(function () {
        // The homepage's shell is the fallback for pages without a file yet.
        return readBackendFile("index.html").then(
          function (indexShell) {
            return indexShell;
          },
          function () {
            return siteFetch("index.html").then(function (res) {
              return res.text();
            });
          }
        );
      })
      .then(function (indexShell) {
        var pages = declaredPages();

        return Promise.all(
          pages.map(function (decl) {
            var path = decl.slug + ".html";
            var page = findProjectPage(decl.slug);
            if (!page) return null;

            var shellPromise =
              decl.slug === "index"
                ? Promise.resolve(indexShell)
                : readBackendFile(path).catch(function () {
                    return indexShell;
                  });

            return shellPromise.then(function (shell) {
              return { path: path, content: buildPageHtml(shell, decl, page.getMainComponent()) };
            });
          })
        );
      })
      .then(function (pageFiles) {
        var files = pageFiles.filter(Boolean);
        files.push({
          path: PROJECT_PATH,
          content: JSON.stringify(state.editor.getProjectData(), null, 2) + "\n",
        });
        files.push({
          path: PAGE_CSS_PATH,
          content: PAGE_CSS_HEADER + state.editor.getCss() + "\n",
        });
        files.push({
          path: SYMBOLS_PATH,
          content: JSON.stringify({ symbols: state.symbols }, null, 2) + "\n",
        });
        if (state.customBlocks.length || state.hadBlocksFile) {
          files.push({
            path: BLOCKS_PATH,
            content: JSON.stringify(state.customBlocks, null, 2) + "\n",
          });
        }
        return files;
      });
  }

  /* --- GitHub backend ---------------------------------------------------------
     One commit for the whole save, via the git-data API: read the branch head,
     write a tree on top of it, commit, move the ref. Plain fetch, no SDK. */

  function ghFetch(path, opts) {
    opts = opts || {};
    var headers = {
      Authorization: "Bearer " + state.token,
      Accept: opts.accept || "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    var init = { headers: headers, method: opts.method || (opts.body ? "POST" : "GET") };
    if (opts.body) init.body = JSON.stringify(opts.body);
    return fetch("https://api.github.com/repos/" + state.repo + path, init).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            throw new Error("GitHub: " + (body.message || "HTTP " + res.status));
          });
      }
      return opts.raw ? res.text() : res.json();
    });
  }

  function ghCommit(files, message) {
    var head;
    return ghFetch("/git/ref/heads/" + encodeURIComponent(state.branch))
      .then(function (ref) {
        head = ref.object.sha;
        return ghFetch("/git/commits/" + head);
      })
      .then(function (commit) {
        return ghFetch("/git/trees", {
          body: {
            base_tree: commit.tree.sha,
            tree: files.map(function (file) {
              return { path: file.path, mode: "100644", type: "blob", content: file.content };
            }),
          },
        });
      })
      .then(function (tree) {
        return ghFetch("/git/commits", {
          body: { message: message, tree: tree.sha, parents: [head] },
        });
      })
      .then(function (commit) {
        return ghFetch("/git/refs/heads/" + encodeURIComponent(state.branch), {
          method: "PATCH",
          body: { sha: commit.sha },
        });
      });
  }

  function verifyGithub(announce) {
    return ghFetch("").then(function (repo) {
      if (repo.permissions && repo.permissions.push === false) {
        throw new Error("GitHub: that token cannot push to " + state.repo);
      }
      state.mode = "github";
      ui.save.disabled = false;
      if (announce) {
        status("Connected to " + state.repo + " (" + state.branch + "). Save commits directly.");
      }
    });
  }

  /** Try the CMS's token, then the builder's own — no prompt. Signing in to
      either editor once signs you in to both. */
  function autoConnectGithub() {
    var token = sveltiaToken() || state.token;
    if (!state.repo || !token) return;
    state.token = token;

    verifyGithub(false)
      .then(function () {
        status("Signed in with the shared GitHub token. Save commits to " + state.branch + ".");
      })
      .catch(function () {
        state.mode = null; // stale token — the Connect button still works
      });
  }

  function connectGithub() {
    if (!state.repo) {
      status("config.yml has no backend.repo — set it first.", true);
      return;
    }
    var token = window.prompt(
      "Paste a GitHub personal access token with write access to " +
        state.repo +
        ".\nStored in this browser only, and shared with the CMS — sign in once, use both.",
      sveltiaToken() || state.token
    );
    if (!token) return;
    state.token = token.trim();

    status("Checking access to " + state.repo + "…");
    verifyGithub(true)
      .then(function () {
        localStorage.setItem(TOKEN_KEY, state.token);
        shareTokenWithSveltia(state.token);
      })
      .catch(function (err) {
        status(err.message, true);
      });
  }

  /* --- local folder backend ------------------------------------------------ */

  function writeLocal(path, content) {
    var parts = path.split("/");
    var name = parts.pop();
    var walk = Promise.resolve(state.dirHandle);
    parts.forEach(function (part) {
      walk = walk.then(function (dir) {
        return dir.getDirectoryHandle(part, { create: true });
      });
    });
    return walk
      .then(function (dir) {
        return dir.getFileHandle(name, { create: true });
      })
      .then(function (handle) {
        return handle.createWritable();
      })
      .then(function (writable) {
        return writable.write(content).then(function () {
          return writable.close();
        });
      });
  }

  function connectLocal() {
    window
      .showDirectoryPicker({ mode: "readwrite" })
      .then(function (handle) {
        // Refuse a folder that is not this site — writing index.html into the
        // wrong directory is exactly the accident this check exists for.
        return handle.getFileHandle("index.html").then(
          function () {
            state.dirHandle = handle;
            state.mode = "local";
            ui.save.disabled = false;
            status("Working with the local folder “" + handle.name + "”. Save writes files directly.");
          },
          function () {
            status("That folder has no index.html — pick the site's root folder.", true);
          }
        );
      })
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        status(err.message || String(err), true);
      });
  }

  /* --- save ----------------------------------------------------------------- */

  function save() {
    if (!state.mode) {
      status("Connect GitHub or a local folder before saving.", true);
      return;
    }
    ui.save.disabled = true;
    status("Exporting…");

    collectFiles()
      .then(function (files) {
        if (state.mode === "local") {
          return Promise.all(
            files.map(function (file) {
              return writeLocal(file.path, file.content);
            })
          ).then(function () {
            status("Saved to the local folder. Commit and push when it looks right.");
          });
        }
        return ghCommit(files, "page: edit in the visual builder").then(function () {
          status("Committed to " + state.branch + " — GitHub Pages redeploys in about a minute.");
        });
      })
      .catch(function (err) {
        status(err.message || String(err), true);
      })
      .then(function () {
        ui.save.disabled = false;
      });
  }

  /* --- starter blocks: copies that arrive wearing the site's classes -------- */

  function saveBlock() {
    var selected = state.editor && state.editor.getSelected();
    if (!selected) {
      status("Select an element in the canvas first, then save it as a block.", true);
      return;
    }
    var label = window.prompt("Name this block:");
    if (!label) return;

    var html = selected.toHTML();
    var css = "";
    try {
      css = state.editor.getCss({ component: selected }) || "";
    } catch (error) {
      /* older API — block still works, styles stay in page.css */
    }
    var block = {
      id: "saved-" + slugify(label) + "-" + (state.customBlocks.length + 1),
      label: label,
      content: css.trim() ? html + "<style>" + css + "</style>" : html,
    };

    state.customBlocks.push(block);
    state.editor.BlockManager.add(block.id, {
      label: block.label,
      content: block.content,
      category: "Saved blocks",
    });
    status("Block “" + label + "” added to the panel — committed with the next save.");
  }

  var BLOCKS = [
    {
      id: "section",
      label: "Section",
      content:
        '<section><header class="section-head"><p class="eyebrow">Eyebrow</p>' +
        '<h2 class="section-head__title">A new section</h2>' +
        '<p class="section-head__blurb">Say more here.</p></header></section>',
    },
    { id: "eyebrow", label: "Eyebrow", content: '<p class="eyebrow">Eyebrow</p>' },
    { id: "heading", label: "Heading", content: '<h2 class="section-head__title">Heading</h2>' },
    { id: "paragraph", label: "Paragraph", content: "<p>Write here.</p>" },
    {
      id: "button",
      label: "Button",
      content: '<a class="btn btn--solid" href="#">Do the thing</a>',
    },
    { id: "image", label: "Image", content: { type: "image" } },
  ];

  /* --- boot ------------------------------------------------------------------ */

  function boot() {
    if (typeof window.grapesjs === "undefined") {
      status("GrapesJS did not load — check the network and the pinned CDN line.", true);
      return;
    }
    if ("showDirectoryPicker" in window) ui.local.hidden = false;
    ui.github.addEventListener("click", connectGithub);
    ui.local.addEventListener("click", connectLocal);
    ui.save.addEventListener("click", save);
    ui.saveBlock.addEventListener("click", saveBlock);
    ui.makeSymbol.addEventListener("click", makeSymbol);
    ui.pageSelect.addEventListener("change", switchPage);

    // Inside the dashboard (admin/index.html embeds this page via shell.js),
    // offer the way back. The dashboard removes the overlay on this message.
    if (window.self !== window.top) {
      var back = document.createElement("button");
      back.id = "back-to-content";
      back.textContent = "‹ Content";
      back.addEventListener("click", function () {
        var dirty = 0;
        try {
          dirty = state.editor ? state.editor.getDirtyCount() : 0;
        } catch (error) {
          /* older API — skip the guard */
        }
        if (dirty > 0 && !window.confirm("Leave the builder? Unsaved page edits will be lost.")) {
          return;
        }
        window.parent.postMessage({ type: "pure-builder:close" }, window.location.origin);
      });
      var bar = document.querySelector(".bar");
      bar.insertBefore(back, bar.firstChild);
    }

    Promise.all([
      loadConfig(),
      loadContent(),
      fetchJSON(PROJECT_PATH),
      fetchJSON(BLOCKS_PATH),
      fetchJSON(SYMBOLS_PATH),
    ])
      .then(function (results) {
        state.content = results[1];
        state.pages = (results[1].pages || {}).pages || [];
        var projectData = results[2];
        if (Array.isArray(results[3])) {
          state.customBlocks = results[3];
          state.hadBlocksFile = true;
        }
        state.symbols = ((results[4] || {}).symbols || []).slice();
        autoConnectGithub();
        return projectData
          ? { projectData: projectData }
          : loadSeedHtml().then(function (html) {
              return { components: html };
            });
      })
      .then(function (source) {
        var options = {
          container: "#gjs",
          height: "100%",
          fromElement: false,
          storageManager: false,
          // Keep the canvas identical to the real page: no editor-injected
          // resets, and page.css content comes from the project data itself.
          protectedCss: "",
          canvas: {
            styles: [FONTS_URL, new URL("assets/css/styles.css", SITE_BASE).href],
            // GrapesJS's default frameStyle paints the canvas body white, which
            // hides the site's own dark body background. Keep only its
            // scrollbar styling so the canvas shows exactly what the site does.
            frameStyle:
              "* ::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.1) }" +
              "* ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2) }" +
              "* ::-webkit-scrollbar { width: 10px }",
          },
          assetManager: { upload: false },
          blockManager: {
            blocks: BLOCKS.concat(
              state.customBlocks.map(function (block) {
                return {
                  id: block.id,
                  label: block.label,
                  content: block.content,
                  category: "Saved blocks",
                };
              })
            ),
          },
        };
        if (source.projectData) options.projectData = source.projectData;
        else options.components = source.components;

        state.editor = window.grapesjs.init(options);
        state.editor.on("component:add", handleSymbolDrop);
        state.editor.on("page", renderPageSelect);
        state.editor.on("load", function () {
          syncPages();
          syncSymbols();
          bakeCanvas();
          status(
            source.projectData
              ? "Loaded content/page.grapes.json."
              : "First run: imported index.html. The first save creates content/page.grapes.json."
          );
        });
      })
      .catch(function (err) {
        status(err.message || String(err), true);
      });
  }

  boot();

  // Console/debug access — lets you inspect the editor, dry-run a full export
  // (await PureBuilder.collectFiles()), or drive flows without saving.
  window.PureBuilder = {
    state: state,
    collectFiles: collectFiles,
    buildPageHtml: buildPageHtml,
    readBackendFile: readBackendFile,
  };
})();
