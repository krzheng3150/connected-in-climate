# Migrating to a New DigitalOcean Instance

This guide covers moving the Connected in Climate app to a new DigitalOcean account with a custom domain (Porkbun) and custom email (Zoho Mail). It assumes the new account has no existing app — you're starting fresh.

## Prerequisites

- A DigitalOcean account with App Platform access
- The GitHub repo (fork it or grant the new account access to `krzheng3150/connected-in-climate`)
- A DigitalOcean API token (Full Access) — generate at cloud.digitalocean.com → API → Tokens
- A Clerk application — create at clerk.com. Enable social login providers (Google, LinkedIn, Microsoft) under User & Authentication → Social Connections. LinkedIn requires a LinkedIn OAuth app (linkedin.com/developers).
- A domain registered on Porkbun (e.g., `connectedinclimate.com`)
- A Zoho Mail account for sending from the custom domain

## Step 1: Update `.do/app.yaml`

The app spec has instance-specific values that must change. Edit `.do/app.yaml`:

| Field | What to change | How to find it |
|-------|---------------|----------------|
| `services[0].github.repo` | New GitHub owner/repo | Your fork or the shared repo |
| `services[0].envs → DATABASE_URL` | `${NEW_DB_NAME.DATABASE_URL}` | DO auto-generates the DB name when you create the app — update after step 2 |
| `services[0].envs → ADMIN_EMAILS` | New admin email addresses | Whoever should have admin access |
| `services[0].envs → CLERK_PUBLISHABLE_KEY` | New Clerk publishable key | clerk.com → your app → API Keys |
| `services[0].envs → VITE_CLERK_PUBLISHABLE_KEY` | Same value as above | Needed at build time for the Vite frontend |
| `databases[0].name` | New DB name | DO assigns this — update after step 2 |
| `region` | Preferred region (e.g., `nyc`, `sfo`, `tor`) | Optional — change if needed |

Values you do NOT need to change: `engine`, `version`, `http_port`, `instance_size_slug`, `run_command`, `health_check`, `NODE_ENV`, and the `type: SECRET` entries (those are injected by the deploy workflow from GH Actions secrets).

## Step 2: Create the App on DigitalOcean

1. Go to **cloud.digitalocean.com → Apps → Create App**
2. Connect the GitHub repo and branch (`main`)
3. DO will detect the app spec and create the app with a dev database
4. Note the auto-generated **database name** (e.g., `dev-db-XXXXXX`) — update `app.yaml` as described in step 1

## Step 3: Set GitHub Actions Secrets

GitHub Actions secrets are tied to the **repo**, not the domain or DO instance. Most existing secrets stay the same. Only update secrets that change with the new account.

Go to **github.com → your repo → Settings → Secrets and variables → Actions**:

| Secret | When to update | Where to get it |
|--------|---------------|----------------|
| `DIGITALOCEAN_ACCESS_TOKEN` | Only if moving to a new DO account | DigitalOcean → API → Tokens (Full Access) |
| `CLERK_SECRET_KEY` | Only if using a new Clerk app | clerk.com → your app → API Keys → Secret Key |
| `RESEND_API_KEY` | Only if using a new Resend account | resend.com → API Keys |
| `OPENAI_API_KEY` | Rarely — same key works across instances | platform.openai.com → API Keys |
| `GOOGLE_OAUTH_CLIENT_ID` | Only if using a new Google OAuth app | Google Cloud Console → Credentials → OAuth 2.0 Client |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same as above | Same as above |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Only if re-authorizing | Run `npm run google:auth` locally |

These are NOT set in the DO console — the deploy workflow injects them automatically.

## Step 4: Custom Domain (Porkbun → DigitalOcean)

### 4a. Add the domain in DigitalOcean

1. Go to **cloud.digitalocean.com → Apps → your app → Settings → Domains**
2. Click **Add Domain** and enter your domain (e.g., `connectedinclimate.com`)
3. DO will show you a **CNAME** record to create

### 4b. Configure DNS on Porkbun

Log in to **porkbun.com → Domain Management → your domain → DNS Records**:

| Type | Host | Value | Notes |
|------|------|-------|-------|
| CNAME | `@` or `www` | The value DO gave you (e.g., `your-app-xxxxx.ondigitalocean.app.`) | Points the domain to DO |
| CNAME | `www` | `connectedinclimate.com` | Redirects www → apex (if using apex as primary) |

Some registrars don't allow CNAME on the apex (`@`). Porkbun supports ALIAS/CNAME flattening — if not, use `www` as primary and set up a redirect from apex.

### 4c. Wait for SSL

DO automatically provisions a Let's Encrypt SSL certificate once DNS propagates. This can take a few minutes to a few hours. Check status in **Apps → Settings → Domains**.

## Step 5: Zoho Mail Setup

### 5a. Add domain to Zoho

1. Go to **zoho.com/mail → Admin Console → Domains → Add Domain**
2. Enter your domain and verify ownership (Zoho will give you a TXT record)

### 5b. Add Zoho DNS records on Porkbun

Add these records in **Porkbun → DNS Records**:

| Type | Host | Value | Notes |
|------|------|-------|-------|
| TXT | `@` | Zoho verification string | Domain verification |
| MX | `@` | `mx.zoho.com` (priority 10) | Primary mail server |
| MX | `@` | `mx2.zoho.com` (priority 20) | Backup mail server |
| MX | `@` | `mx3.zoho.com` (priority 50) | Backup mail server |
| TXT | `@` | `v=spf1 include:zoho.com ~all` | SPF — authorizes Zoho to send |
| CNAME | `zmail._domainkey` | Value from Zoho DKIM setup | DKIM — email authentication |

### 5c. Create mailboxes

Create the email addresses you need in Zoho (e.g., `hello@connectedinclimate.com`). Update `ADMIN_EMAILS` in `app.yaml` if admins will use the new addresses.

## Step 6: Resend Domain Verification

Resend sends notification emails on behalf of the app. It must be authorized for the new domain.

1. Go to **resend.com → Domains → Add Domain**
2. Enter your custom domain
3. Resend will give you DNS records (TXT for SPF, CNAME for DKIM) — add them on Porkbun
4. Wait for verification (usually a few minutes)
5. Update the `FROM` address in `server/email.js` if it references a hardcoded domain

## Step 7: Clerk Domain Configuration

Clerk needs to know about the new domain so login redirects work correctly.

1. Go to **clerk.com → your app → Domains**
2. Add the custom domain as an allowed origin (e.g., `https://connectedinclimate.com`)
3. Remove the old `*.ondigitalocean.app` origin if no longer needed
4. If switching to Clerk's **production instance**: create a new production instance, update `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` in `app.yaml`, and update `CLERK_SECRET_KEY` in GH Actions secrets

## Step 8: Google OAuth Redirect URIs

Google OAuth (used for Google Drive integration) needs the new domain in its allowed redirect URIs.

1. Go to **Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client**
2. Under **Authorized redirect URIs**, add `https://connectedinclimate.com/api/auth/google/callback` (or whatever your callback path is)
3. Under **Authorized JavaScript origins**, add `https://connectedinclimate.com`
4. Remove old origins/URIs if no longer needed

## Step 9: LinkedIn OAuth App (if used)

If LinkedIn is enabled as a Clerk social login provider:

1. Go to **linkedin.com/developers → your app → Auth**
2. Under **Authorized redirect URLs**, update to use the new domain
3. This is configured through Clerk — check Clerk's LinkedIn provider settings for the exact redirect URL to add

## Step 10: Migrate the Database (if needed)

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

Or re-import from a CSV / JSON file:
```bash
DATABASE_URL="$NEW_DATABASE_URL" node --env-file=.env scripts/import.js <source>
```

## Step 11: Deploy and Verify

Push to `main` (or re-run the workflow). The deploy workflow will:
1. Inject secrets from GH Actions into the app spec
2. Sync the app spec and deploy the app
3. Run smoke tests (health check + frontend load)

Manual verification:
```bash
# Health check
curl -sf "https://connectedinclimate.com/api/health"
# Should return {"ok": true}

# Frontend
curl -sf -o /dev/null -w '%{http_code}' "https://connectedinclimate.com/"
# Should return 200
```

Also verify:
- Social login works (Google, LinkedIn, Microsoft) on the new domain
- Email notifications arrive (create a test match or use Resend's test mode)
- Google Drive folder creation works (match a test mentee/mentor)

## Checklist

- [ ] App spec updated with new repo, DB name, admin emails, Clerk publishable keys
- [ ] App created on DO App Platform
- [ ] GitHub Actions secrets updated (only `DIGITALOCEAN_ACCESS_TOKEN` if new DO account)
- [ ] Custom domain added in DO and DNS configured on Porkbun
- [ ] SSL certificate provisioned by DO
- [ ] Zoho Mail set up — MX, SPF, DKIM records on Porkbun
- [ ] Resend domain verified for the custom domain
- [ ] Clerk updated — custom domain as allowed origin, production keys if switching
- [ ] Google OAuth redirect URIs updated for new domain
- [ ] LinkedIn OAuth redirect URLs updated (if applicable)
- [ ] Database migrated (or profiles re-imported)
- [ ] Deploy succeeded
- [ ] Social login works on the new domain
- [ ] Email notifications work
- [ ] Google Drive integration works
- [ ] Old DO instance decommissioned after confirming everything works
