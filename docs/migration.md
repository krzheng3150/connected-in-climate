# Migrating to a New DigitalOcean Instance

This guide covers moving the Connected in Climate app to a different DigitalOcean account or team. It assumes the new account has no existing app — you're starting fresh.

## Prerequisites

- A DigitalOcean account with App Platform access
- The GitHub repo (fork it or grant the new account access to `krzheng3150/connected-in-climate`)
- A DigitalOcean API token (Full Access) — generate at cloud.digitalocean.com → API → Tokens

## Step 1: Update `.do/app.yaml`

The app spec has instance-specific values that must change. Edit `.do/app.yaml`:

| Field | What to change | How to find it |
|-------|---------------|----------------|
| `services[0].github.repo` | New GitHub owner/repo | Your fork or the shared repo |
| `services[0].envs → DATABASE_URL` | `${NEW_DB_NAME.DATABASE_URL}` | DO auto-generates the DB name when you create the app — update after step 2 |
| `services[0].envs → ADMIN_EMAILS` | New admin email addresses | Whoever should have admin access |
| `services[0].envs → GOOGLE_SERVICE_ACCOUNT_EMAIL` | New service account email | Google Cloud Console → IAM → Service Accounts |
| `databases[0].name` | New DB name | DO assigns this — update after step 2 |
| `region` | Preferred region (e.g., `nyc`, `sfo`, `tor`) | Optional — change if needed |

Values you do NOT need to change: `engine`, `version`, `http_port`, `instance_size_slug`, `run_command`, `health_check`, `NODE_ENV`, and the `type: SECRET` entries (those are set in the DO console, not in the file).

## Step 2: Create the App on DigitalOcean

1. Go to **cloud.digitalocean.com → Apps → Create App**
2. Connect the GitHub repo and branch (`main`)
3. DO will detect the app spec and create the app with a dev database
4. Note the auto-generated **database name** (e.g., `dev-db-XXXXXX`) — update `app.yaml` as described in step 1

## Step 3: Set Secrets in the DO Console

These cannot be set via the app spec file — they must be entered manually:

| Secret | Where to get it |
|--------|----------------|
| `OPENAI_API_KEY` | platform.openai.com → API Keys (not currently used for matching — TF-IDF is local — but referenced in the spec) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Cloud Console → IAM → Service Accounts → Keys → Create Key (JSON). Paste the raw JSON as the value. |
| `RESEND_API_KEY` | resend.com → API Keys. Also verify/add the sending domain. |

Set these at: **Apps → your app → Settings → web component → Environment Variables**

## Step 4: Set GitHub Actions Secret

The deploy workflow needs a DO API token:

1. Go to **github.com → your repo → Settings → Secrets and variables → Actions**
2. Add a repository secret: `DIGITALOCEAN_ACCESS_TOKEN` = your DO API token from the prerequisites

## Step 5: Migrate the Database (if needed)

Skip this if starting fresh with no existing profiles/matches.

**Export from the old instance:**
```bash
pg_dump "$OLD_DATABASE_URL" --no-owner --no-acl > backup.sql
```

**Import to the new instance:**
```bash
psql "$NEW_DATABASE_URL" < backup.sql
```

The new DO database already has `pgvector` available. The app runs schema migrations on startup (`server/db.js`), so tables will exist — `pg_dump` with `--no-owner --no-acl` avoids permission conflicts.

If you only want to migrate profiles (not match history):
```bash
pg_dump "$OLD_DATABASE_URL" --no-owner --no-acl -t user_profiles > profiles.sql
psql "$NEW_DATABASE_URL" < profiles.sql
```

Or re-import from your Google Sheet / CSV:
```bash
DATABASE_URL="$NEW_DATABASE_URL" node --env-file=.env scripts/import.js <source>
```

## Step 6: Deploy and Verify

Push to `main` (or re-run the workflow). The deploy workflow will:
1. Sync the app spec to DO
2. Build and deploy the app
3. Run smoke tests (health check + admin email recognition)

Manual verification:
```bash
# Health check
curl -sf "https://YOUR_APP.ondigitalocean.app/api/health"

# Admin access
curl -sf "https://YOUR_APP.ondigitalocean.app/api/profiles/me?email=YOUR_ADMIN_EMAIL"
# Should return {"is_admin": true, ...}
```

## Step 7: Google Sheets (if used)

If using Google Sheets for profile import:
1. Create a new Google Cloud service account (or share the existing one with the new team)
2. Share the Google Sheet with the service account email
3. Run `npm run sheet:create -- <sheet-url>` to set up headers and dropdowns

## Checklist

- [ ] App spec updated with new repo, DB name, admin emails, service account
- [ ] App created on DO App Platform
- [ ] Secrets set in DO console (OPENAI_API_KEY, GOOGLE_SERVICE_ACCOUNT_KEY, RESEND_API_KEY)
- [ ] `DIGITALOCEAN_ACCESS_TOKEN` set in GitHub repo secrets
- [ ] Database migrated (or profiles re-imported)
- [ ] Deploy succeeded
- [ ] Smoke tests pass (health + admin email)
- [ ] Google Sheet shared with service account (if applicable)
- [ ] Resend sending domain verified for the new account
