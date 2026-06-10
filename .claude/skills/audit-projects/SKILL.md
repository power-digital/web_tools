---
name: audit-projects
description: Audit every sub-project in this repo against the shared conventions documented in `.claude/skills/new-project/SKILL.md`. Reports a punch-list of drift — missing CSS variables, header markup differences, hash-prefix collisions, missing theme script, runtime console errors, unlinked projects. Read-only; never fixes anything automatically. Invoke when the user says "audit projects", "check consistency", "are projects still aligned", "any drift?", "before I ship", or similar.
---

# audit-projects — find convention drift across sub-projects

The repo is a collection of independent static tools that share conventions but no code. As projects multiply, small drifts (missing CSS variable, divergent header markup, duplicate hash prefix) creep in. This skill scans everything and produces a punch-list. **It never edits files** — only reports.

## Workflow

### 1. Inventory

List every top-level directory that contains an `index.html`:

```
find . -maxdepth 2 -name 'index.html' -not -path './.git/*' -not -path './.github/*' -not -path './.claude/*' -not -path './_site/*' -not -path './node_modules/*'
```

The repo root's `index.html` is the **landing page**, not a project. Everything else is a project.

Also read:
- `.claude/skills/new-project/SKILL.md` — the canonical convention list.
- Root `index.html` — to confirm each project is linked.
- `README.md` — to confirm each project is mentioned.
- `.github/workflows/static.yml` — to confirm new folders aren't accidentally excluded.

### 2. Per-project checks

For each project, build a section in the report. Mark each item with ✅ (pass), ❌ (fail), or ⚠️ (warn for minor / cosmetic).

**Files**
- Has `index.html`, `styles.css`, `app.js`
- No `package.json`, `node_modules/`, `dist/`, or other build artifacts
- No unintended files (anything starting with `_` is usually a leftover test file — flag)

**HTML — `<head>`**
- `<meta charset="utf-8">` present
- Pre-paint theme script in `<head>` that:
  - Reads `localStorage.getItem('web_tools.theme')` (the exact key — site-wide)
  - Falls back to `prefers-color-scheme: dark`
  - Sets `document.documentElement.dataset.theme = 'dark'` when dark
- Title is set (not still `{{TITLE}}`)

**HTML — header shell**
- `<header class="app-header">` exists
- `<div class="app-header__inner">` inside it
- `<a class="back-link" href="../">` — the path must be `../` (relative), not `/` or absolute
- `<h1>` is non-empty (no placeholders)
- `<div class="header-controls">` exists
- `#theme-toggle` button inside `.header-controls`

**HTML — body**
- `<main class="container">` wraps content
- If the project calls `setStatus(...)` anywhere in `app.js`, there's a `#status-line` element
- No leftover placeholders like `{{TITLE}}`, `{{TAGLINE}}`, `{{HASH_PREFIX}}` in the served HTML

**CSS — variables (these MUST exist by exact name)**
In `:root`:
```
--bg, --surface, --surface-alt, --fg, --muted, --border,
--accent, --accent-hover, --accent-soft,
--danger, --success, --shadow, --radius
```
In `html[data-theme="dark"]` — same set overridden.

Tools: `grep -E '^\s*--(bg|surface|surface-alt|fg|muted|border|accent|accent-hover|accent-soft|danger|success|shadow|radius)\s*:' <project>/styles.css` — count results; should be 13 in `:root` + 13 in `[data-theme="dark"]` (give or take dark-only or light-only ones, but the names should all appear).

Flag any variable missing by name. Extra app-specific vars are fine — don't flag.

**CSS — base classes**
- `.app-header`, `.app-header__inner`, `.back-link`, `.header-controls` styled
- `.container` defined with max-width centered layout
- Button family: `.btn`, `.btn-primary`, `.btn-icon`, `.btn-accent`, `.btn-danger`

**JS**
- Wrapped in IIFE — file starts with `(function () {` or `(() => {` and ends with `})();`
- `'use strict';` near the top
- `#theme-toggle` click handler wired
- If URL-state model: a `HASH_PREFIX` constant (collect for cross-project check)
- If URL-state model: uses `LZString.compressToEncodedURIComponent` + `decompressFromEncodedURIComponent`
- If URL-state model: **opens empty** — init does **not** call `syncURLNow()` (grep the init/bottom of the IIFE; a `syncURLNow()` on load stamps a hash onto a clean URL and is drift), and `defaultState()` (or the blank-state factory) carries no sample/demo values. Only a shared link with a populated hash should arrive with content.
- Theme storage uses key `'web_tools.theme'` exactly (site-wide sync depends on this)

**Wiring**
- Linked from root `index.html` — there's a `<li><a href="./<slug>/">` in `<ul class="projects">`
- Mentioned in `README.md` under `## Projects` with the formula `- **[Title](./<slug>/)** — description.`

**Runtime (boot the page in headless Chrome)**

First, kill any stale Chrome / server processes from previous runs — leftover `--user-data-dir` instances cause hangs:

```bash
pkill -f "Google Chrome" 2>/dev/null
pkill -f "python3 -m http.server" 2>/dev/null
sleep 2
```

Start a local server:

```bash
python3 -m http.server 8765 > /tmp/audit-server.log 2>&1 &
SERVER_PID=$!
sleep 1
```

For each project, run Chrome with a manual PID-based timeout (macOS lacks `timeout(1)`):

```bash
rm -rf /tmp/audit-chrome-<slug>
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --headless --disable-gpu --no-sandbox \
  --user-data-dir=/tmp/audit-chrome-<slug> \
  --enable-logging=stderr --log-level=0 \
  --virtual-time-budget=2000 \
  --window-size=1400,900 \
  --screenshot=/tmp/audit-<slug>.png \
  "http://localhost:8765/<slug>/" 2>/tmp/audit-<slug>.err &
CPID=$!
sleep 5
ps -p $CPID > /dev/null && kill -9 $CPID 2>/dev/null
```

Then grep stderr for real JS errors, **filtering out Chrome's own infrastructure noise**:

```bash
grep -iE 'console|error|uncaught|TypeError|ReferenceError' /tmp/audit-<slug>.err | \
  grep -vE 'trust_store_mac|cv_display_link_mac|policy qualifiers|certificate|CVDisplayLinkCreate|external_pref_loader|sqlite_persistent_store_backend|FlushAndNotifyInBackground|Failed to post task|gcm/engine|PHONE_REGISTRATION_ERROR|Authentication Failed|Failed to log in to GCM|registration_request|mcs_client'
```

Anything left is a real JS error in the page.

When done, clean up:

```bash
kill $SERVER_PID 2>/dev/null
pkill -f "Google Chrome" 2>/dev/null
```

### 3. Cross-project checks

**Hash-prefix collisions** — collect every `HASH_PREFIX` constant from each project's `app.js`. If two projects share the same prefix, flag it (their URLs would collide when crossed-pasted).

```bash
grep -hE "HASH_PREFIX\s*=\s*['\"]" */app.js
```

**Library version drift** — collect every CDN URL across all projects:

```bash
grep -hE "cdn\.jsdelivr|cdnjs|unpkg" */index.html | sort -u
```

If two projects load different versions of the same library (e.g. `lz-string@1.4.0` vs `lz-string@1.5.0`), flag it — security / consistency wise it's worth aligning.

**Deploy exclusions** — read `.github/workflows/static.yml`'s `rsync --exclude` list. If a project folder name happens to match an exclusion pattern (rare but possible), flag it.

### 4. Report

Output a single Markdown report in this shape:

```markdown
# Audit report — <date>

## meeting-agenda
✅ Files complete
✅ Pre-paint theme script
❌ CSS variable `--shadow` missing from `:root`
⚠️ Uses `marked@12.0.2`, but `dbt-config` uses no Markdown — no drift, just FYI
✅ Runtime: no console errors

## dbt-config
…

## Cross-project
✅ Hash prefixes unique (`#m=`, `#c=`)
❌ `lz-string` version mismatch: meeting-agenda@1.5.0 vs dbt-config@1.5.0 (✅ actually fine — placeholder example)
```

End with a tight summary: "N projects audited, X failures, Y warnings." If everything passes, say so plainly.

### 5. Do NOT auto-fix

Even when the fix is obvious (e.g. adding a missing CSS variable), report it and stop. The user might have intentionally diverged. After the report, ask if they want fixes applied, then handle each item explicitly.

## What "drift" looks like (judgement calls)

- **Missing CSS variable** → flag. Other projects expect it; theme sync depends on it.
- **Extra CSS variable** → don't flag. App-specific is fine.
- **Different button background color** → only flag if it breaks light/dark contrast.
- **Different copy in URL hint banner** → don't flag. Each app's voice is its own.
- **Theme storage key ≠ `web_tools.theme`** → flag hard. This silently breaks the site-wide theme sync.
- **Header markup deviates** → flag. Visual consistency across projects is the whole reason for the shared shell.
- **JS not in IIFE** → flag. Globals leak between projects when iframed/embedded.
