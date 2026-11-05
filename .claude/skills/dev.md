---
description: General development workflow for Connected in Climate. Use when building features, fixing bugs, or making any non-trivial change to the codebase.
---

# Dev Workflow

Follow this workflow for any feature or non-trivial change. The goal is fewer iterations and no forgotten files.

## 1. Scope

Identify what's changing and which files are affected. Read `CLAUDE.md` for the key files table and conventions. Classify the change:

- **New profile field** → also follow `/add-field`
- **New API route** → also follow `/test-api`
- **UI change** → identify if Playwright demo (`scripts/demo/`) needs updating
- **Bug fix** → identify root cause before writing code

## 2. Preview

For any non-trivial step, show the plan before writing code:
- Which files will be created or modified
- Key design decisions and tradeoffs
- Which sub-workflows apply (add-field, test-api, doc-sync)

Wait for approval before implementing. Small, obvious changes (typo fixes, single-line bug fixes) can skip this.

## 3. Implement

Follow repo conventions from `CLAUDE.md`:
- Dynamic fields go in `payload` JSONB — no schema migrations
- Auth via `getAuthEmail(req)` from `server/auth.js`
- Enum fields use snake_case IDs from `field-registry.js`, never human labels
- Validation reuses `normalize()` / `normalizeArray()` from field-registry
- TF-IDF embeddings recomputed on every profile save (create + edit)
- Matches are immutable snapshots — never mutate `computation_payload`

## 4. Test

- Write or update tests matching established patterns. Existing test files:
  - `server/field-registry.test.js` + `server/matching.test.js` — unit tests (no DB)
  - `server/match-api.test.js`, `server/action-feedback-api.test.js`, `server/admin-api.test.js` — API tests (need DB)
  - `server/profile-api.test.js` — profile create/update tests (need DB)
  - `server/auth.test.js` — auth helper tests
  - `server/email.test.js` — email notification tests
- API tests use: express app with `clerkMiddleware()`, `x-user-email` header for auth, `beforeEach` DB cleanup
- Run `npm run test:all` and confirm all pass (206 tests as of last count)

## 5. Demo

If UI changed, update the Playwright demo:
- `scripts/demo/fixtures.js` — test data constants
- `scripts/demo/helpers.js` — page action functions (use `reactClick`/`reactClickNth` for React production build compatibility)
- `scripts/demo/scenario.js` — the step-by-step flow
- Run `npm run demo` to verify

## 6. Docs

After feature work, check if docs need updating. Run `/doc-sync` or manually check:
- `CLAUDE.md` — key files table, conventions
- `README.md` — project description, commands, deploy secrets
- `docs/primer.md` — algorithm, design decisions, milestones, field propagation
- `docs/migration.md` — setup steps, secrets workflow, checklist

## 7. Verify

Run the full test suite one final time: `npm run test:all`

If the DB isn't running: `npm run db:up` then wait 4 seconds before testing.
