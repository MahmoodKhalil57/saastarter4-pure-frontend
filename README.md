# pure-frontend

A landing page for a shop that has not opened yet. Pure HTML and CSS — no build
step, no dependencies to install, and the page reads complete with JavaScript
turned off. JS only adds motion and live niceties. Two editors commit straight
back to this repository, and a commit on `master` is a deploy:

- **[Sveltia CMS](https://sveltiacms.app/)** (`/admin/`) edits _data_: catalog
  items, craft steps, questions, footer links, the announcement bar, settings.
- **The visual builder** (`/admin/builder.html`,
  [GrapesJS](https://grapesjs.com/)) edits _the page itself_ — words, layout,
  cosmetics — and exports plain HTML and CSS.

The seeded content is a calligraphy supply workshop (Qalam & Ahar). Every word and
image is CMS-editable, so replace it with the real shop when you have one.

## Layout

```
index.html (+ <slug>.html)  the pages — complete HTML, exported by the builder
assets/css/styles.css       hand-written styling
assets/css/page.css         styling authored in the visual builder
assets/js/render.js         the JSON -> HTML renderers (shared: page + builder)
assets/js/main.js           runtime enhancement: refresh data, wire forms, motion
content/pages/<slug>.json   one entry per page             -> CMS "Pages"
content/symbols/<id>.json   one entry per reusable element -> CMS "Symbols"
content/pages.json          baked manifest of the pages (builder artifact)
content/symbols.json        baked manifest of the symbols (builder artifact)
content/page.grapes.json    the builder's project file — every page's drawing
content/blocks.grapes.json  designer-saved starter blocks
content/site.json           announcement, contact, backend -> CMS "Settings"
content/landing.json        steps, FAQ, form behaviour     -> CMS "Landing page"
content/catalog.json        the Lot One grid               -> CMS "Catalog"
media/uploads/              images uploaded through the CMS
admin/index.html            loads Sveltia CMS from a CDN — the dashboard
admin/config.yml            the content model
admin/builder.html          loads GrapesJS from a CDN
admin/builder.js            the whole builder integration
admin/preview.js            live preview inside the CMS
admin/shell.js              puts the builder inside the dashboard
.nojekyll                   tells GitHub Pages to serve the files as-is
```

Who owns what: `index.html` is a compiled artifact of the builder. Its `<head>`
is hand-owned and preserved verbatim on every save; its `<body>` is whatever was
last saved in the builder, with the CMS data lists baked in so the page needs no
JavaScript to read. `main.js` only _refreshes_ the lists and the announcement
from `/content/*.json` at load, so a CMS edit shows up before the next builder
save. If a fetch fails — or JS is off — the baked page stands.

## Two editors, one rule

The two admin surfaces are not two ways to do the same thing.
**Sveltia owns what things _are_; the builder owns what they _look like_.**
(Equivalently: the builder owns what you would point at; the CMS owns what
you would count or configure.)

Concretely, Sveltia **creates and binds**, one entry per thing:

- **Pages** (`content/pages/<slug>.json`): slug, title, description, menu
  label. The builder composes each declared page and exports it to
  `<slug>.html`; it cannot create or delete pages. Give a page a menu label
  and the site menu renders from the Pages list on every page.
- **Symbols** (`content/symbols/<id>.json`): reusable elements and their
  backend **bindings**. A symbol bound to a form (`type: form`, plus the
  form's slug from `odash.json`) gets its submit endpoint stamped at export
  and wired at runtime — backend functionality attaches here, as
  configuration, never as code in the builder. The "Put my name down"
  form is the live example: one symbol, placed twice, bound to the
  `opening-notice` form.

The builder bakes aggregated manifests (`content/pages.json`,
`content/symbols.json`) on every save so the static runtime can read the
lists without a directory listing; the entry files are the source of truth.

And the builder **draws and places**: page bodies, symbol bodies (declared
symbols appear as stubs to fill in), instances from the "Reusable" block
category. Editing a symbol updates every instance on every page.

- **GrapesJS** (`/admin/builder.html`) is for visual building — the singular:
  layout, structure, cosmetics, one-off copy. It builds pages out of blocks,
  and it builds the blocks themselves: select anything in the canvas, hit
  **Save block**, and it joins the block panel for reuse. The library lives in
  `content/blocks.grapes.json`, committed with the page.
- **Sveltia** (`/admin/`) is for what must be standardized: anything that
  exists N times with one shape (catalog items, steps, questions, links), and
  anything that configures behaviour (form endpoint, announcement, contact).
  Repetition needs a schema, and a schema needs a form — that is Sveltia.
- **The bridge** is a `data-list` container. The builder decides _where_
  repeated content sits and how everything around it looks; the CMS decides
  _what_ the items are; `render.js` turns one into the other — baked into the
  HTML at save time, refreshed live in the browser.

The graduation path — copy, reference, data:

```
copy (Save block)   →   reference (Make reusable)   →   data (collection)
   builder                   builder + Symbols             Sveltia
```

A saved block is a stamp: dropped copies diverge, which is right for "start
from this pattern." A symbol is a reference: edit once, updated everywhere,
and bindable to the backend. When a symbol's instances keep wanting different
content in the same shape, it has outgrown being a symbol — add its fields to
`admin/config.yml`, give its container a `data-list`, teach `render.js` the
item shape, and count it in the CMS from then on.

One sign-in covers both: each tool stores the GitHub token where the other
looks, so signing in to the CMS unlocks the builder and vice versa. Whoever
can push to the repository can do both — that is the entire permission model.

## Setup, once

1. **Push this directory to a GitHub repository** with `master` as the default branch.
2. **Point `admin/config.yml` at that repository.** Change `backend.repo` to
   `owner/name`, and `site_url` / `display_url` to the Pages URL. Nothing else
   needs touching.
3. **Turn on Pages.** Repository → Settings → Pages → Source: *Deploy from a
   branch* → Branch: `master`, folder: `/ (root)`. The site appears at
   `https://<owner>.github.io/<repo>/` within a minute or two.

## Editing content

Open `https://<owner>.github.io/<repo>/admin/` and choose **Sign in with token**.

The dialog links to GitHub's token page with the right scopes pre-selected. Create
a fine-grained or classic token with `repo` access, paste it back, and you are in.
The token lives in your browser's local storage only — it never touches this
repository. Tokens expire (90 days by default); when yours does, generate another.

There is no OAuth option because GitHub Pages is static and OAuth needs a server to
hold the client secret. If you want a proper sign-in button for non-technical
editors later, deploy
[sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth) to a Cloudflare
Worker, then add `base_url` to the backend block and put `oauth` back into
`auth_methods`.

The preview pane shows the real page, not an abstract field list: `admin/preview.js`
registers a preview template per file that injects `index.html` into Sveltia's
preview iframe and re-runs the site's own renderers (`render.js`) on every
keystroke — draft values for the file being edited, committed content for the
rest. Not-yet-committed image uploads preview via blob URLs.

Saving in the CMS commits to `master`, which redeploys the site. Give it a minute.

## Editing the page visually

Open the dashboard (`/admin/`) and pick **Builder** at the top of the sidebar —
the builder opens inside the dashboard, on the same sign-in, and **‹ Content**
brings you back to where you were. (`/admin/builder.html` also works directly;
it is the same tool.)

The builder is [GrapesJS](https://grapesjs.com/) pinned from a CDN, editing the
real pages against the real stylesheet. The first run imports `index.html` once;
after that the editor loads its own project file and never re-parses the HTML —
`content/page.grapes.json` is the source of truth for every page, and each
`<slug>.html` is re-exported from it on every save. With more than one page
declared in Structure → Pages, a page switcher appears in the top bar. A page's
`<head>` is its current file's head with the title/description from its Pages
entry applied — so SEO lives in the CMS while the rest of the head stays
hand-editable. Saving writes everything in one commit:

```
content/page.grapes.json    the editable project (all pages, all symbols)
<slug>.html                 every declared page, CMS data baked in
assets/css/page.css         styles authored in the editor
content/symbols.json        the symbol registry (builder adds, CMS binds)
content/blocks.grapes.json  saved starter blocks, if any
```

If you have signed in to the CMS in this browser, the builder picks up the
same GitHub token automatically — no second sign-in. Otherwise **Connect
GitHub** asks for a personal access token (stored in this browser only, and
shared back to the CMS), reads the repository from `admin/config.yml`, and
commits straight to `master`. In a Chromium browser, **Work with local
folder** writes the files to disk instead — pair it with `bunx serve .` and
commit when it looks right.

Regions rendered from CMS data — the catalog grid, the steps, the questions,
the footer links, the announcement bar — appear in the canvas but are locked:
edit them in the CMS. The builder re-bakes them from the latest JSON into every
export. Two things follow from the export model: hand edits to `index.html`'s
`<body>` and to `assets/css/page.css` are overwritten by the next builder save
(hand-written markup belongs in the builder; hand-written CSS in `styles.css`),
and the `<head>` stays yours to edit directly.

## Working locally

```sh
bunx serve .          # or: python3 -m http.server 8000
```

Open `http://localhost:8000/`. Open `http://localhost:8000/admin/` and Sveltia
offers **Work with Local Repository** — it edits the files on disk through the File
System Access API (Chromium browsers), no token and no commits until you push. The
visual builder does the same at `http://localhost:8000/admin/builder.html` via
**Work with local folder**.

## This repository is public

Everything here is readable by anyone, deliberately. Nothing in it is a secret and
nothing in it may become one. Anything that needs a secret, shared state, identity,
or write authority lives in the backend — `saastarter4-emdash` — and the line
between the two is written down in that repo's `ARCHITECTURE.md`.

The two values that connect them, `backend.url` and `backend.form`, are public by
design. The form id identifies a form; it does not authorise anything.

## The sign-up form

Three places it can go, in order:

1. **The backend.** Set **Settings → Backend** in the CMS to your
   `saastarter4-emdash` URL and the form's slug. Submissions are stored there,
   with spam protection and notifications.
2. **A third-party endpoint.** Set **Landing page → Sign-up form → Form endpoint**
   to a Formspree/Basin URL.
3. **Nothing configured** — the form opens the visitor's mail app addressed to
   **Settings → Contact → Email**, so no address is silently dropped.

Submissions are sent as `FormData` on purpose: `multipart/form-data` is a CORS-safe
content type, so the browser skips the preflight round trip that JSON would force
on every submission.

## When this becomes a real shop

The catalog is one JSON file with a list inside it, because a static host cannot
list a directory — the page would have no way to discover files in a
`content/products/` folder. That is fine for a handful of items. Past roughly
thirty, switch the catalog to a folder collection and add a GitHub Action that
writes an index file on each commit.

## Pinned version

`admin/index.html` pins Sveltia CMS to `0.187.0` rather than tracking latest, so a
CDN release can never change the editor without you choosing it. Sveltia logs a
console warning when a newer version ships; bump the one line to take it.
`admin/builder.html` pins GrapesJS to `0.23.5` for the same reason — two lines
there (the script and its stylesheet) to bump together.
