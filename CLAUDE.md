# Connected in Climate

Mentor/mentee matchmaking platform for climate tech professionals. React (Vite) frontend, Express.js API, PostgreSQL 17 + pgvector. Deployed to DigitalOcean App Platform.

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
| Google Sheet setup | `scripts/create-sheet.js` |
| Google auth | `scripts/google-auth.js` |
| Auth (shared helper) | `server/auth.js` |
| Admin backend | `server/admin-api.js` |
| Application form (frontend) | `client/src/components/ApplicationForm.jsx` |
| Profile creation/edit API | `server/profile-api.js` |
| Auth context & profile state | `client/src/context/AuthContext.jsx` |
| User dashboard | `client/src/pages/Dashboard.jsx` |
| Match detail panel | `client/src/components/MatchDetailPanel.jsx` |
| Client routes | `client/src/App.jsx` |
| E2E demo | `scripts/demo/` (`scenario.js` for the flow, `helpers.js` for page actions) |
| Email notifications | `server/email.js` |
| DO deploy & app spec | `.do/app.yaml` + `.github/workflows/deploy.yml` |
| Migrating to a new DO instance | `docs/migration.md` |

## Conventions

- **JSONB payload for dynamic fields.** Stable columns (`email`, `name`, `role`) for queries; everything else in the `payload` JSONB column. No schema migrations for new profile fields.
- **Run-based match pipeline.** Algorithm → creates a `match_run` (PENDING_REVIEW) with top N as `CANDIDATE` matches → admin batch-reviews the run (`POST /api/admin/runs/:run_id/review`) → approved 1–3 → mentee picks (`ACTIVE`). Auto-activates if admin approves exactly 1. `TOP_CANDIDATES` constant in `match-api.js` controls N. Run statuses: PENDING_REVIEW → AWAITING_MENTEE / ACTIVE / CANCELLED. Match statuses: CANDIDATE → APPROVED / REJECTED → ACTIVE / FINISHED. STORED for below-cutoff.
- **Matches are immutable snapshots.** Never mutate a `computation_payload`. Profile changes only affect future match runs.
- **Block list ≠ rejection.** The `rejections` table is a block list (prevents future matching). Rejecting a match does NOT auto-block — admin decides separately.
- **Auth via Clerk.** Social login (Google, LinkedIn, Microsoft) on the frontend (`@clerk/react`), session verification on the backend (`@clerk/express`). `server/auth.js` exports `getAuthEmail(req)` — extracts verified email from the Clerk session, falls back to `x-user-email` header in non-production (for tests). Admin routes still gated by `ADMIN_EMAILS` env var.
- **Self-service profile creation.** Users without a profile see a multi-step application form (`ApplicationForm.jsx`). `POST /api/profiles` creates, `PATCH /api/profiles` updates. Validation reuses `field-registry.js` normalize/normalizeArray. Existing users can edit their profile from the dashboard. Profiles can also be bulk-imported via Google Sheets.
- **Profile field propagation.** New field → `field-registry.js` → `import.js` → `ProfileFields.jsx` (LABELS + FIELD_NAMES + FIELD_ORDER) → `ApplicationForm.jsx` (add to the appropriate step) → `profile-api.js` (add to the correct field set) → `sample-profiles.csv`. Then re-run `npm run sheet:create -- <url>` to update sheet dropdowns.
- **Google Sheets import.** `import.js` accepts a Google Sheet URL or a local file. Authenticated via service account (`GOOGLE_SERVICE_ACCOUNT_KEY` env var — file path locally, raw JSON on DO). Sheet setup: `npm run sheet:create -- <url>` configures headers, dropdowns (labels from `field-registry.js`), Reference tab, and header protection on an existing sheet shared with the service account. Multi-select fields accept pipes, newlines, or semicolons. Both labels and IDs resolve via `normalize()`.
- **TF-IDF embeddings.** Computed locally at import time and at profile creation/edit time (no OpenAI API calls). Stored in pgvector `VECTOR(1536)` column. `profile-api.js` recomputes the embedding on every save.
- **Deploy secrets via GH Actions.** Secrets (`CLERK_SECRET_KEY`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`) are stored as GitHub Actions secrets and injected into the app spec at deploy time by the workflow. They are NOT set manually in the DO console. The health check (`/api/health`) is mounted above `clerkMiddleware()` so deploys aren't blocked by Clerk misconfiguration. When adding or removing a secret, update all three: `README.md` (secrets table), `.do/app.yaml` (env vars), `.github/workflows/deploy.yml` (inject step).

## Keeping this file current

When you add a new key file, convention, or architectural pattern, update this file. When you change something listed here, update or remove it. This file is auto-loaded — stale info is worse than no info.
