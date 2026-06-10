---
name: new-project
description: Scaffold a new sub-project in this repo (web_tools — a collection of standalone static HTML/CSS/JS tools deployed to GitHub Pages). Invoke when the user says "add a new project", "create another tool", "scaffold X", "let's build a Y tool", or similar.
---

# new-project — scaffold a sub-project in `web_tools`

This repo hosts a collection of standalone static web tools at `https://<user>.github.io/web_tools/`. Each tool lives in its own folder (e.g. `meeting-agenda/`, `dbt-config/`). They share **conventions** but no shared code — every project is self-contained vanilla HTML/CSS/JS. There is **no build step**.

## Workflow when invoked

### 1. Clarify

Use **AskUserQuestion** if any of these are not clear from the request:

- **What does it do?** One sentence. (Becomes the landing-page tagline.)
- **Folder slug** — kebab-case (`meeting-agenda`, `dbt-config`). Suggest one.
- **Emoji icon** — small visual aid. Suggest one fitting the tool.
- **Persistence model**:
  - **`url`** *(default, recommended)* — full state is JSON → LZ-string-compressed into the URL hash. Share = save. The same pattern as `meeting-agenda` and `dbt-config`. Use for documents/configurations the user produces.
  - **`localStorage`** — survives reloads on this browser only. Use only if state is private/transient *and* sharing makes no sense.
  - **`none`** — stateless tool (converter, calculator). Strip out the state code entirely.
- **Extra CDN libraries needed?** Examples: `marked` + `dompurify` for Markdown, `sortablejs` for drag-drop, `chart.js` for charts.

### 2. Scaffold

Copy every file in `.claude/skills/new-project/_template/` into `<slug>/` at the repo root. Then in the new files:

- Replace `{{TITLE}}` with the human title (e.g. "Meeting Agenda"). It appears in `<title>`, `<h1>`, and a few other spots.
- Replace `{{TAGLINE}}` with the one-sentence purpose.
- Replace `{{HASH_PREFIX}}` with a short, project-distinct prefix like `#m=`, `#c=`, `#n=`. Look at sibling projects to avoid collisions.
- If persistence is **`localStorage`** instead of url: replace the URL-state block in `app.js` with a `loadState`/`saveState` pair that uses `localStorage.getItem('<slug>.v1')` and `setItem`. Remove the `lz-string` script tag from `index.html`.
- If persistence is **`none`**: delete the entire `// ----- URL state -----` and `// ----- copy link -----` blocks, remove the `#copy-link` button from the header, remove the `lz-string` CDN tag. Keep `setStatus`, `$`, `debounce` helpers.
- Append CDN `<script>` tags for any extra libraries *above* `./app.js` in `index.html`.

### 3. Link from the landing page

Open `<repo>/index.html`. Find the `<ul class="projects">` block. Append one `<li>` after the last existing project, **matching the exact pattern** already used (no emoji in the `<h2>` — the others don't have any, so don't add one):

```html
<li>
  <a href="./<slug>/">
    <h2>{{TITLE}}</h2>
    <p>{{TAGLINE_FOR_LANDING}}</p>
  </a>
</li>
```

The landing tagline can be slightly longer and more descriptive than the in-app tagline — see the existing two entries for the style.

### 4. Update README.md

Add a bullet under `## Projects` matching the existing formula precisely:

```
- **[{{TITLE}}](./<slug>/)** — {{one-or-two-sentence description ending in a period}}
```

### 5. Verify

Tell the user to test:

```
python3 -m http.server 8000
# then open http://localhost:8000/<slug>/
```

If you want to verify visually before reporting done, you can headless-screenshot:

```
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless --disable-gpu --no-sandbox \
  --user-data-dir=/tmp/chrome-newproj --window-size=1400,900 \
  --screenshot=/tmp/new.png --virtual-time-budget=3000 \
  "http://localhost:8000/<slug>/"
```

Then `Read` `/tmp/new.png`.

---

## Cross-project conventions (do not violate without asking)

### File layout
- One folder per project, never nested. Kebab-case names.
- Minimum three files: `index.html`, `styles.css`, `app.js`. No subdirectories unless the user explicitly asks.
- **No build step**. No `package.json`, no `node_modules/`, no transpiler config. CDN scripts only.

### Theming (this is shared across the WHOLE site)
- Pre-paint inline `<script>` in `<head>` reads `localStorage.getItem('web_tools.theme')` and sets `document.documentElement.dataset.theme = 'dark'` to prevent a flash on dark-mode loads.
- A `#theme-toggle` button in `.header-controls` flips between light/dark and writes back to `localStorage.web_tools.theme` (`'dark'` or `'light'`).
- CSS variables defined in `:root` (light) and `html[data-theme="dark"]` (dark). The template `styles.css` has the full palette — keep these variable names, change colors only if intentional.

### Header shell (sticky, same on every project)

```html
<header class="app-header">
  <div class="app-header__inner">
    <a href="../" class="back-link" title="Back to projects">←</a>
    <h1>{{TITLE}}</h1>
    <div class="header-controls">
      <!-- project-specific actions -->
      <button id="theme-toggle" class="btn-icon" ...>🌙</button>
    </div>
  </div>
</header>
```

### URL-state pattern (when persistence = url)
- `lz-string@1.5.0` from jsdelivr.
- Encode: `LZString.compressToEncodedURIComponent(JSON.stringify(state))`.
- Decode: `LZString.decompressFromEncodedURIComponent(hash)` → `JSON.parse`.
- Hash prefix unique to project (`#m=`, `#c=` already used).
- Debounce URL writes with `history.replaceState` (~250ms) to avoid hammering it.
- Listen to `hashchange` for browser back/forward and external paste.
- A "🔗 Copy link" button in the header copies `location.href` to clipboard.
- **Always open empty.** `defaultState()` must contain no sample/demo data — empty arrays/strings, toggles off. **Only a shared link (hash present) populates anything**; every other visit opens blank.
- **Never write the hash on init.** Do *not* call `syncURLNow()` at the end of init — that would stamp a hash onto a clean URL on first load. The hash is written only after the user actually edits something (the change/input handlers call `syncURL`). On load, `let state = decodeState(readHash()) || defaultState();` loads a shared link if one is present, otherwise stays empty.

### JS conventions
- Wrap everything in an IIFE: `(function () { 'use strict'; ... })();`
- Helpers typically present: `$ = (sel, root=document) => root.querySelector(sel)`, `$$`, `debounce(fn, ms)`, `setStatus(msg, kind)`.
- Status messages via `#status-line` element (template includes one) with `role="status"` and `aria-live="polite"`. Use `setStatus('...', 'success' | 'error' | '')`.
- IDs and event wiring at the bottom of the IIFE. No global handlers.

### Deployment
`.github/workflows/static.yml` rsync-copies the repo (excluding `.git`, `.github`, `.gitignore`, `node_modules`, `.DS_Store`, `_site`) into `_site/` on push to `main`. New folders just get picked up — no workflow edit needed.

---

## Anti-patterns (refuse or push back)

- **No build tool.** Webpack, Vite, esbuild, parcel — all out. Plain HTML/CSS/JS only.
- **No secrets baked into client code.** If the tool talks to a third-party API that needs a key/webhook, the user must enter it at runtime; store it only in *their* `localStorage`.
- **No backend.** GitHub Pages is static-only.
- **localStorage is for preferences**, not for document state. Document state belongs in the URL (`url` persistence model). The exception: things that are clearly private/transient and shouldn't ever leak via a shared link.
- **No demo/sample data on load, ever.** A fresh visit must open empty. Don't seed `defaultState()` with example values to "show off" the tool, and don't write the hash on init. Only a shared link with a populated hash should arrive with content.
- **Don't reach for frameworks.** No React/Vue/Svelte for these small tools. Vanilla DOM is the convention; deviating means a much bigger change the user should explicitly approve.
- **Don't copy/import from sibling projects.** They're independent on purpose; refactoring shared code into a common file is a separate (and bigger) decision.
