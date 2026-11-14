# Connected in Climate

Mentor/mentee matchmaking platform for climate tech professionals. React (Vite) frontend, Express.js API, PostgreSQL 17 + pgvector. Deployed to DigitalOcean App Platform.

- **Design docs:** `docs/primer.md` (algorithm & architecture) | `docs/design.md` | [Google Doc](https://docs.google.com/document/d/1n1yqMimYnSUDaC_lV49F4yo33U1V3lm_/edit)
- **AI/dev context:** `CLAUDE.md`

## How it works

1. Users sign in via Clerk (Google, LinkedIn, or Microsoft) and fill out a multi-step application form
2. Mentees click "Find a Mentor" — the algorithm scores every eligible mentor using categorical overlap, topic alignment, TF-IDF semantic similarity, and experience
3. Top candidates go to admin for batch review
4. Approved mentors are presented to the mentee, who picks one
5. Both sides see the active match on their dashboard and can leave feedback

Profiles can also be bulk-imported from a CSV or JSON file.

## Local development

Requires Node 20+ and Docker.

```sh
cp .env.example .env    # fill in Clerk keys + other secrets
npm install
npm --prefix client install
npm run db:up            # Postgres 17 in Docker on :5432
npm run dev              # API on :3000, Vite on :5173 (proxies /api)
```

Open http://localhost:5173.

## Testing

```sh
npm run test             # unit tests (field registry, matching algorithm)
npm run test:all         # all tests (unit + API + auth + profile + email)
npm run demo             # E2E Playwright demo (headed, with slowmo)
npm run demo:headless    # E2E Playwright demo (headless)
```

## Deploying

Pushing to `main` triggers the deploy workflow (`.github/workflows/deploy.yml`), which:
1. Injects secrets from GitHub Actions into the app spec
2. Syncs the spec and deploys to DigitalOcean App Platform
3. Runs smoke tests (health check + frontend load)

### Required GitHub Actions secrets

| Secret | Source |
|--------|--------|
| `DIGITALOCEAN_ACCESS_TOKEN` | DigitalOcean API → Tokens |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys |
| `RESEND_API_KEY` | Resend dashboard → API Keys |
| `OPENAI_API_KEY` | OpenAI dashboard → API Keys |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials (OAuth 2.0 Desktop client) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same OAuth client as above |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | One-time consent flow via `scripts/google-oauth-setup.js` |

Non-secret env vars (Clerk publishable key, admin emails, etc.) are set directly in `.do/app.yaml`.

See `docs/migration.md` for moving to a new DigitalOcean account.
