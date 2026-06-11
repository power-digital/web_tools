# web_tools

Collection of Power Digital tools and utilities, deployed to GitHub Pages from this repo.

## Projects

- **[Meeting Agenda](./meeting-agenda/)** — Run meetings with timed agenda items, take notes, export to Markdown. The entire meeting state lives in the URL — copy the link to save or share; opening it anywhere restores the meeting verbatim. No server, no accounts, no storage to manage.
- **[dbt Config Generator](./dbt-config/)** — Guided form that generates `dbt_project.yml`, `sources.yml`, and `packages.yml` (hub / git / local packages), handling required and optional config keys (including structured column tests), with a live YAML preview. Import existing YAML to edit it. The full form state lives in the URL — copy the link to save or share it; opening it anywhere restores the config verbatim. Download each file, or copy it to the clipboard. Runs entirely client-side, no server.
- **[Regex Builder](./regex-builder/)** — Build a regular expression by stacking plain-English condition rows (exact text, a character type, one of these words, a character set, common formats like email / URL / dates, plus "must contain" / "must not contain" assertions), each with a friendly repeat control. Anchors, whole-word, and flag toggles round it out. A live test panel highlights matches as you type and a plain-English explanation describes the generated pattern. The full setup lives in the URL — copy the link to save or share. No AI, no server.
- **[Cron Builder](./cron-builder/)** — Build and read cron expressions with a visual editor, a grid of common presets, or direct field input. Shows a plain-English description of the schedule and the next eight run times in your browser's local time. Handy for dbt Cloud and other scheduled jobs. Runs entirely client-side, no server.
- **[Code Formatter](./formatter/)** — Paste SQL, JSON, or Python and get it cleanly formatted. SQL follows the sqlfmt style (lowercase keywords, trailing commas, 4-space indent, hierarchy-first wrapping) with Snowflake / BigQuery / PostgreSQL dialects; JSON is pretty-printed; Python is formatted with Ruff (black-compatible) compiled to WebAssembly. Runs entirely client-side — nothing leaves your browser.

## Local preview

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Deployment

Pushes to `main` deploy to GitHub Pages via `.github/workflows/static.yml`.
