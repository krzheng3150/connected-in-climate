---
description: Check and fix stale documentation after feature work. Scans CLAUDE.md, README.md, primer.md, and migration.md for references that no longer match the code.
---

# Doc Sync

After feature work, scan documentation for staleness. Report findings grouped by file and priority before making changes.

## Files to check

### `CLAUDE.md` (highest priority — auto-loaded every session)

1. **Key files table**: Does every important file have a row? Were any files renamed or removed?
2. **Conventions**: Do they accurately describe current behavior? Watch for:
   - Auth flow (how users sign in, what they see without a profile)
   - Profile creation/edit paths (self-service vs import)
   - Match pipeline (statuses, review flow)
   - Deploy workflow (secrets, health check)
   - Field propagation chain (all files in the right order)
   - Embedding computation (when it happens)
3. **Commands**: Do `package.json` scripts match what's documented?

### `README.md`

1. **Project description**: Does it match what the app actually does?
2. **Local dev instructions**: Correct Node/Postgres versions? All setup steps?
3. **Testing**: Are test commands listed?
4. **Deploy**: Required secrets, workflow description
5. **Links**: Do referenced docs/URLs still exist?

### `docs/primer.md`

1. **Algorithm description**: Still accurate? Phase weights, field list?
2. **Design decisions**: Still current? Auth model, match lifecycle?
3. **Field propagation**: All files in the chain?
4. **Milestones**: Reflect completed work?

### `docs/migration.md`

1. **Secret management**: Matches actual workflow (GH Actions injection, not manual DO console)?
2. **Step numbering**: Consistent after any changes?
3. **Smoke tests**: Match what the deploy workflow actually runs?
4. **Checklist**: All items current?

## How to check

1. Read each doc file
2. Cross-reference against:
   - `git diff main` or recent commits (what changed)
   - Current file contents (what exists now)
   - `package.json` scripts
   - `.github/workflows/deploy.yml` (deploy workflow)
   - `.do/app.yaml` (app spec)
3. Report findings as a prioritized list: **Stale** (says something wrong) vs **Missing** (doesn't mention something it should)
4. Get approval before applying fixes
