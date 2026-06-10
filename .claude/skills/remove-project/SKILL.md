---
name: remove-project
description: Cleanly delete a sub-project from this repo. Removes the folder, unlinks it from the root landing page, drops its bullet from README.md, and surfaces any cross-references before deletion. This is destructive — always confirms before deleting. Invoke when the user says "delete the X project", "remove X tool", "kill the X folder", "drop X", or similar.
---

# remove-project — clean removal of a sub-project

The inverse of `/new-project`. Deletes the folder and unwires every reference to it across the landing page and README. Always confirms before any destructive step.

## Workflow

### 1. Identify the project

If the user named one in their request, use that slug. Otherwise, list candidates and ask:

```bash
find . -maxdepth 2 -name 'index.html' -not -path './.git/*' -not -path './.github/*' -not -path './.claude/*' -not -path './_site/*'
```

Skip the root `index.html` — that's the landing page, not a project.

If the named slug doesn't exist as a folder, stop and tell the user. Don't guess at similarly-named folders.

### 2. Search for stragglers

Before deleting, surface every reference to the slug **outside** the project folder, the landing page, and README:

```bash
grep -rl '<slug>' . \
  --exclude-dir=.git --exclude-dir=.github --exclude-dir=.claude \
  --exclude-dir=_site --exclude-dir=node_modules \
  --exclude-dir=<slug>
```

Then narrow to what's *not* the landing page or README:

```bash
# (show the user any matches outside index.html and README.md)
```

If matches appear in another sub-project, surface them and ask — they might be intentional cross-links the user wants to preserve or update. Don't just barrel through.

### 3. Confirm

Always confirm before any deletion. Be specific about what will happen:

> About to remove `<slug>/`:
> - Delete the folder `<slug>/` and all files inside it.
> - Remove the `<li>` linking to it from `/index.html`.
> - Remove the bullet from `/README.md`.
>
> The git history keeps a copy. Proceed?

Wait for a yes. A maybe / unsure / hedged response is a no.

### 4. Remove

In order:

1. **Folder**:
   ```bash
   rm -rf <slug>/
   ```
   Refuse to run if the path expands to anything containing `..`, `/`, `.git`, `.github`, `.claude`, or the repo root itself.

2. **Landing `index.html`** — find the `<li>` whose nested `<a>` has `href="./<slug>/"`. Remove the whole `<li>` block including indentation and the trailing newline. Use the `Edit` tool with enough surrounding context to make the match unique (the `href` attribute is usually enough).

3. **`README.md`** — find the bullet line that contains `](./{{slug}}/)` and remove the whole line. Pattern is `- **[Title](./<slug>/)** — …`.

### 5. Verify

```bash
ls -la <slug> 2>&1   # should say no such file
grep -c '<slug>' index.html README.md   # should be 0 in both
```

### 6. Report

Tell the user:
- What was deleted (folder + how many files inside it).
- What was unlinked (one line in `index.html`, one bullet in `README.md`).
- That the changes aren't committed — they can inspect with `git status` / `git diff` and commit when ready.

## Safety rules (non-negotiable)

- **Never** `rm` anything outside `<repo>/<slug>/`. No `.git/`, no `.github/`, no `.claude/`, no sibling projects, no root files.
- **Never** auto-commit. The user might want to inspect or revert first.
- **Never** force-push or amend an existing commit.
- If the user requests deletion of multiple projects in one shot, process them one at a time with confirmation each — the cost of a wrong delete is higher than the friction of confirming twice.
- If something feels off (folder missing, README doesn't have the expected bullet, weird cross-references in unrelated files), **stop and report** rather than improvising. The user knows their repo better.
