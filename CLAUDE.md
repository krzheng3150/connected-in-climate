# Connected in Climate

Mentor/mentee matchmaking platform for climate tech professionals. React (Vite) frontend, Express.js API, PostgreSQL 16 + pgvector. Deployed to DigitalOcean App Platform.

- AI primer (algorithm, decisions, field propagation): `docs/primer.md`
- Full design doc: `docs/design.md` | [Google Doc](https://docs.google.com/document/d/1n1yqMimYnSUDaC_lV49F4yo33U1V3lm_/edit)
- Commands: see `scripts` in `package.json`
- Test data: `scripts/sample-profiles.csv`

## Key files

| If you're changing… | Start here |
|---------------------|-----------|
| Profile field options | `server/field-registry.js` |
| Matching algorithm | `server/matching.js` |
| UI labels & profile rendering | `client/src/components/ProfileFields.jsx` |
| Data import | `scripts/import.js` |
| Admin backend | `server/admin-api.js` |
| Client routes | `client/src/App.jsx` |
| E2E demo | `scripts/demo/` (`scenario.js` for the flow, `helpers.js` for page actions) |

## Conventions

- **JSONB payload for dynamic fields.** Stable columns (`email`, `name`, `role`) for queries; everything else in the `payload` JSONB column. No schema migrations for new profile fields.
- **Multi-match review pipeline.** Algorithm → top N as `PENDING_REVIEW` → admin approves 1–3 (`ADMIN_APPROVED`) → mentee picks (`ACTIVE`). Auto-activates if admin approves exactly 1. `TOP_CANDIDATES` constant in `match-api.js` controls N.
- **Matches are immutable snapshots.** Never mutate a `computation_payload`. Profile changes only affect future match runs.
- **Block list ≠ rejection.** The `rejections` table is a block list (prevents future matching). Rejecting a match does NOT auto-block — admin decides separately.
- **Auth is email-based** for the pilot. Admin routes gated by `ADMIN_EMAILS` env var checked in `requireAdmin` middleware.
- **Profile field propagation.** New field → `field-registry.js` → `import.js` → `ProfileFields.jsx` (LABELS + FIELD_NAMES + FIELD_ORDER) → `sample-profiles.csv`.
- **TF-IDF embeddings.** Computed locally at import time (no OpenAI API calls). Stored in pgvector `VECTOR(1536)` column.

## Keeping this file current

When you add a new key file, convention, or architectural pattern, update this file. When you change something listed here, update or remove it. This file is auto-loaded — stale info is worse than no info.
