# saastarter4-pure-frontend

A landing page for a shop that has not opened yet. Pure HTML, CSS, and JavaScript —
no build step, no dependencies to install. Content is edited through
[Sveltia CMS](https://sveltiacms.app/), which commits JSON straight back to this
repository. A commit on `master` is a deploy.

The seeded content is a calligraphy supply workshop (Qalam & Ahar). Every word and
image is CMS-editable, so replace it with the real shop when you have one.

## Layout

```
index.html              the page
assets/css/styles.css   all styling
assets/js/main.js       loads /content/*.json and fills the page in
content/site.json       brand, contact, SEO, footer      -> CMS "Settings"
content/landing.json    hero, sign-up form, craft, FAQ   -> CMS "Landing page"
content/catalog.json    the Lot One grid                 -> CMS "Catalog"
media/uploads/          images uploaded through the CMS
admin/index.html        loads Sveltia CMS from a CDN
admin/config.yml        the content model
.nojekyll               tells GitHub Pages to serve the files as-is
```

`index.html` ships with the current copy written into it. The JSON files overwrite
it on load. If a fetch ever fails the page still reads correctly — it just shows
whatever was last baked into the HTML.

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

Saving in the CMS commits to `master`, which redeploys the site. Give it a minute.

## Working locally

```sh
bunx serve .          # or: python3 -m http.server 8000
```

Open `http://localhost:8000/`. Open `http://localhost:8000/admin/` and Sveltia
offers **Work with Local Repository** — it edits the files on disk through the File
System Access API (Chromium browsers), no token and no commits until you push.

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

`admin/index.html` pins Sveltia CMS to `0.186.0` rather than tracking latest, so a
CDN release can never change the editor without you choosing it. Sveltia logs a
console warning when a newer version ships; bump the one line to take it.
