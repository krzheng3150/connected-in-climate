# connected-in-climate

Express + React (Vite) + Postgres hello world, deployed to DigitalOcean App Platform at
`connected.climateactionforge.com`.

- `server/` Express API (`/api/health`, `/api/greetings`); also serves the built frontend in production
- `client/` React frontend (Vite)
- `db/schema.sql` Postgres schema, applied idempotently on server start
- `.do/app.yaml` DigitalOcean app spec (service, dev Postgres, domain)
- `.github/workflows/deploy.yml` applies the spec and deploys on every push to `main`

## Local development

Requires Node 20+ and Docker.

```sh
cp .env.example .env
npm install
npm --prefix client install
npm run db:up      # Postgres 16 in Docker on :5432
npm run dev        # API on :3000, Vite on :5173 (proxies /api to the API)
```

Open http://localhost:5173. `npm run db:down` stops the database; add `-v` to
`docker compose down` to wipe its data.

## Deploying

Pushing to `main` runs the deploy workflow, which needs a `DIGITALOCEAN_ACCESS_TOKEN`
repository secret. The app is created on the first run (in your default DigitalOcean project).

DNS: `climateactionforge.com` uses DigitalOcean nameservers, so after the first deploy add a
CNAME record in Networking > Domains: host `connected`, pointing at the app's
`*.ondigitalocean.app` hostname (with a trailing dot). Or set `zone: climateactionforge.com`
on the domain in `.do/app.yaml` to let App Platform manage the record, once that zone exists
in DigitalOcean.
