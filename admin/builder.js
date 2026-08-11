/* ===========================================================================
   Qalam & Ahar — visual page builder
   GrapesJS (pinned from a CDN, like Sveltia) editing the real landing page.
   No build step anywhere; this file is the whole integration.

   The ownership model, which everything below follows:

     content/page.grapes.json   the editor's project file — SOURCE OF TRUTH
                                for the page. The editor loads this, never
                                re-parses index.html (except once, to seed).
     index.html                 a compiled artifact. Every save re-exports it:
                                head kept from the current file, body replaced
                                with the editor's HTML, CMS data baked in so
                                the page is complete without JavaScript.
     assets/css/page.css        styles authored in the editor. styles.css
                                stays hand-written and untouched.
     content/*.json             Sveltia-owned data (catalog, steps, FAQ,
                                links, announcement). Shown locked in the
                                canvas, re-baked fresh into every export.

   Saving writes all three files in ONE commit (GitHub git-data API) or in one
   pass to a local folder (File System Access API), so the repo never holds a
   page whose project file and export disagree.
   =========================================================================== */

(function () {
  "use strict";

  var SITE_BASE = new URL("..", location.href);
  var PROJECT_PATH = "content/page.grapes.json";
  var PAGE_CSS_PATH = "assets/css/page.css";
  var TOKEN_KEY = "pure-builder.github-token";
  var FONTS_URL =
    "https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400..700&display=swap";
  var PAGE_CSS_HEADER =
    "/* Written by the visual builder (admin/builder.html).\n" +
    "   Hand edits here are overwritten on the next builder save — put\n" +
    "   hand-written styles in styles.css instead. */\n";

  var ui = {
    status: document.getElementById("status"),
    save: document.getElementById("save"),
    local: document.getElementById("connect-local"),
    github: document.getElementById("connect-github"),
  };

  var state = {
    editor: null,
    content: null, // { site, landing, catalog }
    mode: null, // "github" | "local"
    repo: null, // "owner/name", from config.yml
    branch: "master",
    token: localStorage.getItem(TOKEN_KEY) || "",
    dirHandle: null,
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

  /* --- asset path forms ----------------------------------------------------
     The CMS stores media as `/media/uploads/x.jpg`. The canvas needs a full
     URL; the exported page wants a relative path so it works both at
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

  /* --- loading ------------------------------------------------------------ */

  function siteFetch(path) {
    return fetch(new URL(path, SITE_BASE).href, { cache: "no-cache" });
  }

  function loadContent() {
    function part(name) {
      return siteFetch("content/" + name)
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .catch(function () {
          return null;
        });
    }
    return Promise.all([part("site.json"), part("landing.json"), part("catalog.json")]).then(
      function (parts) {
        return { site: parts[0] || {}, landing: parts[1] || {}, catalog: parts[2] || {} };
      }
    );
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
      and index.html is never parsed into the editor again. */
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

  /* --- canvas baking --------------------------------------------------------
     CMS-owned regions (data-list / data-text / data-when) are rendered into
     the canvas so editing is WYSIWYG, then locked: they are edited in the CMS,
     and every export re-renders them from fresh JSON anyway. */

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
    var wrapper = state.editor.getWrapper();
    var content = state.content;

    wrapper.find("[data-list]").forEach(function (cmp) {
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

    wrapper.find("[data-text]").forEach(function (cmp) {
      var value = window.PureRender.get(content, cmp.getAttributes()["data-text"]);
      if (!window.PureRender.isFilled(value)) return;
      cmp.components(escapeHtml(value));
      cmp.set({ editable: false });
      cmp.components().forEach(lockDeep);
    });

    wrapper.find("[data-when]").forEach(function (cmp) {
      if (window.PureRender.isFilled(window.PureRender.get(content, cmp.getAttributes()["data-when"]))) {
        cmp.removeAttributes("hidden");
      } else {
        cmp.addAttributes({ hidden: "" });
      }
    });

    // Baking is bookkeeping, not a user edit — keep it out of undo history.
    state.editor.UndoManager.clear();
  }

  /* --- export ----------------------------------------------------------------
     index.html = head of the current file (so hand edits to the head survive)
     + the editor's body + freshly baked CMS data + the file's own script tags. */

  function readShell() {
    if (state.mode === "local" && state.dirHandle) {
      return state.dirHandle
        .getFileHandle("index.html")
        .then(function (handle) {
          return handle.getFile();
        })
        .then(function (file) {
          return file.text();
        });
    }
    if (state.mode === "github") {
      return ghFetch("/contents/index.html?ref=" + encodeURIComponent(state.branch), {
        accept: "application/vnd.github.raw+json",
        raw: true,
      });
    }
    return siteFetch("index.html").then(function (res) {
      if (!res.ok) throw new Error("could not read index.html to keep its <head>");
      return res.text();
    });
  }

  function buildIndexHtml(shellHtml) {
    var doc = new DOMParser().parseFromString(shellHtml, "text/html");

    // The scripts belong to the file, not to the editor: carry them over.
    var scripts = Array.prototype.slice.call(doc.body.querySelectorAll("script"));
    doc.body.innerHTML = state.editor.getHtml();
    scripts.forEach(function (node) {
      doc.body.appendChild(node);
    });

    // Bake current CMS data so the page reads complete without JavaScript.
    window.PureRender.bindAll(doc, state.content, { asset: bakedAsset });

    // The editor's stylesheet must be linked; add the line if it is missing.
    if (!doc.head.querySelector('link[href$="page.css"]')) {
      var link = doc.createElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("href", PAGE_CSS_PATH);
      doc.head.appendChild(link);
    }

    return "<!doctype html>\n" + doc.documentElement.outerHTML + "\n";
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

  function connectGithub() {
    if (!state.repo) {
      status("config.yml has no backend.repo — set it first.", true);
      return;
    }
    var token = window.prompt(
      "Paste a GitHub personal access token with write access to " +
        state.repo +
        ".\nIt is stored in this browser's local storage only — same deal as the CMS token.",
      state.token
    );
    if (!token) return;
    state.token = token.trim();

    status("Checking access to " + state.repo + "…");
    ghFetch("")
      .then(function (repo) {
        if (repo.permissions && repo.permissions.push === false) {
          throw new Error("GitHub: that token cannot push to " + state.repo);
        }
        localStorage.setItem(TOKEN_KEY, state.token);
        state.mode = "github";
        ui.save.disabled = false;
        status("Connected to " + state.repo + " (" + state.branch + "). Save commits directly.");
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

    // Refresh CMS data first so the export bakes what the CMS holds *now*.
    loadContent()
      .then(function (content) {
        state.content = content;
        bakeCanvas();
        return readShell();
      })
      .then(function (shellHtml) {
        var files = [
          {
            path: PROJECT_PATH,
            content: JSON.stringify(state.editor.getProjectData(), null, 2) + "\n",
          },
          { path: PAGE_CSS_PATH, content: PAGE_CSS_HEADER + state.editor.getCss() + "\n" },
          { path: "index.html", content: buildIndexHtml(shellHtml) },
        ];
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

  /* --- blocks: new content arrives already wearing the site's classes ------- */

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

    Promise.all([
      loadConfig(),
      loadContent(),
      siteFetch(PROJECT_PATH).then(function (res) {
        return res.ok ? res.json() : null;
      }),
    ])
      .then(function (results) {
        state.content = results[1];
        var projectData = results[2];
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
          blockManager: { blocks: BLOCKS },
        };
        if (source.projectData) options.projectData = source.projectData;
        else options.components = source.components;

        state.editor = window.grapesjs.init(options);
        state.editor.on("load", function () {
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

  // Console/debug access — lets you inspect the editor and dry-run an export
  // (PureBuilder.buildIndexHtml(html)) without saving anywhere.
  window.PureBuilder = { state: state, buildIndexHtml: buildIndexHtml, readShell: readShell };
})();
