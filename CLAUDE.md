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

- **Dual mentor/mentee applications.** Users can apply as mentor, mentee, or both (separate applications). `user_profiles` stores shared identity (email PK, name, role, shared payload). `mentor_applications` and `mentee_applications` store role-specific payload and embedding (email FK → user_profiles). `deriveRole()` in `roles.js` computes 'mentor'/'mentee'/'both' from which application tables have rows. Payload fields are split: shared fields (career_level, climate_areas, etc.) in `user_profiles.payload`, mentor-specific (motivation, top_strengths, max_capacity, etc.) in `mentor_applications.payload`, mentee-specific (statement_of_intent, top_topics, etc.) in `mentee_applications.payload`. Queries merge payloads with `p.payload || COALESCE(app.payload, '{}')`.
- **JSONB payload for dynamic fields.** Stable columns (`email`, `name`, `role`) for queries; everything else in the `payload` JSONB column (split across user_profiles + application tables). No schema migrations for new profile fields.
- **Run-based match pipeline.** Algorithm → creates a `match_run` (PENDING_REVIEW) with top N as `CANDIDATE` matches → admin batch-reviews the run (`POST /api/admin/runs/:run_id/review`) → approved 1–3 → mentee picks (`ACTIVE`). Auto-activates if admin approves exactly 1. `TOP_CANDIDATES` constant in `match-api.js` controls N. Run statuses: PENDING_REVIEW → AWAITING_MENTEE / ACTIVE / CANCELLED. Match statuses: CANDIDATE → APPROVED / REJECTED → ACTIVE / FINISHED. STORED for below-cutoff.
- **Matches are immutable snapshots.** Never mutate a `computation_payload`. Profile changes only affect future match runs.
- **Block list ≠ rejection.** The `rejections` table is a block list (prevents future matching). Rejecting a match does NOT auto-block — admin decides separately.
- **Auth via Clerk.** Social login (Google, LinkedIn, Microsoft) on the frontend (`@clerk/react`), session verification on the backend (`@clerk/express`). `server/auth.js` exports `getAuthEmail(req)` — extracts verified email from the Clerk session, falls back to `x-user-email` header in non-production (for tests). Admin routes still gated by `ADMIN_EMAILS` env var.
- **Self-service profile creation.** Users without a profile see a multi-step application form (`ApplicationForm.jsx`). `POST /api/profiles` creates (first app creates user_profiles + application row; second app reuses user_profiles, adds the other application). `PATCH /api/profiles` updates the application matching the submitted role. Validation reuses `field-registry.js` normalize/normalizeArray. Existing users can edit their profile or add a second role from the dashboard. Profiles can also be bulk-imported via Google Sheets.
- **Profile field propagation.** New field → `field-registry.js` → `import.js` (add to MENTOR/MENTEE_PAYLOAD_FIELDS if role-specific) → `ProfileFields.jsx` (LABELS + FIELD_NAMES + FIELD_ORDER) → `ApplicationForm.jsx` (add to the appropriate step) → `profile-api.js` (add to SHARED/MENTOR/MENTEE_PAYLOAD_FIELDS) → `sample-profiles.csv`.
- **CSV/JSON import.** `import.js` bulk-imports profiles from a local CSV or JSON file (used by `npm run go`, the demo, and tests). Multi-select fields accept pipes, newlines, or semicolons. Both labels and IDs resolve via `normalize()`. There is no Google Sheet import.
- **TF-IDF embeddings.** Computed locally at import time and at profile creation/edit time (no OpenAI API calls). Stored per-application in `mentor_applications.embedding` (from motivation) and `mentee_applications.embedding` (from statement_of_intent). `profile-api.js` recomputes the embedding on every save.
- **Deploy secrets via GH Actions.** Secrets (`CLERK_SECRET_KEY`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`) are stored as GitHub Actions secrets and injected into the app spec at deploy time by the workflow. They are NOT set manually in the DO console. The health check (`/api/health`) is mounted above `clerkMiddleware()` so deploys aren't blocked by Clerk misconfiguration. When adding or removing a secret, update all three: `README.md` (secrets table), `.do/app.yaml` (env vars), `.github/workflows/deploy.yml` (inject step).

## Keeping this file current

When you add a new key file, convention, or architectural pattern, update this file. When you change something listed here, update or remove it. This file is auto-loaded — stale info is worse than no info.
