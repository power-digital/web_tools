# web_tools — repo guide for Claude

This repo is a collection of standalone static web tools hosted at GitHub Pages. Each tool lives in its own top-level folder (e.g. `meeting-agenda/`, `dbt-config/`) and is self-contained: vanilla HTML/CSS/JS, no build step, no shared runtime.

The tools share **conventions** (theme, CSS variables, header shell, URL-state pattern) but not code.

## Layout

```
/                       Landing page (index.html, styles.css)
/404.html               Themed not-found
/<project>/             One folder per tool — minimum index.html, styles.css, app.js
/.github/workflows/     static.yml deploys via rsync → GitHub Pages
/.claude/skills/        Project-local skills (see below)
/README.md              Human-facing project list (not deployed)
```

## Skills available (invoke with `/<name>`)

- **`/new-project`** — scaffold a new sub-project. Copies `.claude/skills/new-project/_template/` and wires it into the landing page + README. The `SKILL.md` in that folder is also the **canonical style guide** — read it before writing anything new in this repo.
- **`/audit-projects`** — read-only consistency check across all sub-projects. Reports drift (missing CSS variables, wrong theme key, header markup differences, hash-prefix collisions, runtime JS errors) without fixing.
- **`/remove-project`** — clean deletion. Removes the folder, unlinks from landing, drops the README bullet, surfaces any cross-references first. Confirms before deleting.

## Conventions (terse — full version in `.claude/skills/new-project/SKILL.md`)

- **No build step.** Plain HTML/CSS/JS. CDN scripts only. Never add `package.json` / `node_modules`.
- **Theme is site-wide.** Storage key is `web_tools.theme` (`'dark'` or `'light'`). Every page has a pre-paint `<script>` in `<head>` that sets `data-theme="dark"` to avoid a flash. Same toggle button in every header writes back to the same key.
- **CSS variables are the canonical set** — same names in every project: `--bg, --surface, --surface-alt, --fg, --muted, --border, --accent, --accent-hover, --accent-soft, --danger, --success, --shadow, --radius`. Defined in `:root` and overridden in `html[data-theme="dark"]`.
- **Header shell is identical** on every project page: `.app-header → .app-header__inner → .back-link[href="../"] + h1 + .header-controls`. Theme toggle is always `#theme-toggle` in `.header-controls`.
- **State persistence** for documents/configurations: URL hash with `lz-string` compression. Each project picks a unique `HASH_PREFIX` (`#m=`, `#c=`, etc.). `localStorage` is reserved for *user preferences* (currently just `web_tools.theme`), never document state.
- **Always open empty.** Every tool starts blank — `defaultState()` holds no sample/demo data, and init must **not** call `syncURLNow()` (which would stamp a hash onto a clean URL). Only a shared link with a populated hash arrives with content; any other visit opens empty with a clean URL.
- **JS** wraps everything in an IIFE with `'use strict'`. Common helpers: `$ = querySelector`, `$$ = querySelectorAll`, `debounce(fn, ms)`, `setStatus(msg, kind)`, `download(filename, content, mime)`.

## Local dev

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

No build, no watch, no reload — refresh the browser after every change.

## Deploy

Push to `main`. `.github/workflows/static.yml` rsyncs the repo (excluding `.git`, `.github`, `.claude`, `_site`, `.gitignore`, `README.md`, `node_modules`, `.DS_Store`) into `_site/` and publishes via the GitHub Pages action.

Pages source must be set to **"GitHub Actions"** in repo Settings (one-time).

## When in doubt

- Adding a new tool → `/new-project`
- Checking everything's still aligned → `/audit-projects`
- Killing a tool → `/remove-project`
- Style or convention question → read `.claude/skills/new-project/SKILL.md` (source of truth)
