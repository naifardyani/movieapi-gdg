# Deploying FilmLog to Render

Step-by-step guide for deploying the FilmLog API and its static frontend to
[Render](https://render.com).

The target architecture:

```
                    ┌──────────────────────────────┐
   Browser ────────►│ filmlog-web (Static Site)    │
                    │  frontend/ · config.js        │
                    └──────────────┬───────────────┘
                                   │ fetch (HTTPS, CORS open)
                                   ▼
                    ┌──────────────────────────────┐
                    │ filmlog-api (Web Service)     │
                    │  npm start → node dist/server │
                    └──────────────┬───────────────┘
                                   │ DATABASE_URL (internal)
                                   ▼
                    ┌──────────────────────────────┐
                    │ filmlog-db (PostgreSQL)       │
                    └──────────────────────────────┘
```

---

## 0. Prerequisites

| Requirement | Check |
|---|---|
| Code pushed to GitHub | `git push origin main` |
| Node ≥ 22.18 locally | `node -v` |
| Render account | no credit card needed for the free tier |
| Gemini API key | from Google AI Studio |

The repo must contain `prisma/migrations/`. Verify:

```bash
ls prisma/migrations
# 0001_init  migration_lock.toml
```

---

## 1. Create the PostgreSQL database

1. Render Dashboard → **New +** → **PostgreSQL**.
2. Fill in:
   - **Name:** `filmlog-db`
   - **Region:** pick one and **write it down** — the web service must use the same region
   - **Instance Type:** **Free**
3. Click **Create Database** and wait for status **Available**.
4. Open the database → **Info** → copy the **Internal Database URL**.

   It looks like:
   ```
   postgresql://filmlog_db_user:XXXX@dpg-xxxx-a:5432/filmlog_db
   ```

> **Internal vs External URL.** Use the **Internal** URL for the web service —
> it stays inside Render's network (lower latency, no egress). Use **External**
> only when connecting from your laptop (e.g. `psql` or Prisma Studio).

---

## 2. Create the API web service

1. Dashboard → **New +** → **Web Service** → connect the GitHub repo.
2. Configure:

| Field | Value |
|---|---|
| **Name** | `filmlog-api` |
| **Region** | same as the database |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm ci --include=dev && npx prisma generate && npm run build` |
| **Pre-Deploy Command** | `npx prisma migrate deploy && npx prisma db seed` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/api/health` |
| **Instance Type** | **Free** |

### Why `--include=dev`

With `NODE_ENV=production`, npm skips `devDependencies`. `typescript`, `prisma`
and `tsx` all live there, so the build would fail with `tsc: not found`.
`--include=dev` installs them for the build only.

### Why `prisma generate` before `tsc`

`src/config/prisma.ts` imports the generated Prisma Client. Without generation,
the TypeScript build fails.

### If Pre-Deploy Command is unavailable

Some plans/workspaces do not expose it. In that case append the two commands to
the Build Command instead:

```
npm ci --include=dev && npx prisma generate && npm run build && npx prisma migrate deploy && npx prisma db seed
```

Both commands are idempotent:

- `migrate deploy` applies only migrations not yet recorded in `_prisma_migrations`
- the seed uses `upsert`, and validates `data/movies.json` before writing

3. **Environment variables** (expand **Advanced**):

| Key | Value |
|---|---|
| `DATABASE_URL` | the **Internal Database URL** from step 1 |
| `JWT_SECRET` | a long random string (e.g. `openssl rand -base64 48`) |
| `GEMINI_API_KEY` | your Google AI Studio key |
| `NODE_ENV` | `production` |
| `GEMINI_MODEL` | *(optional)* `gemini-3.5-flash-lite` — this is the code default |

> **Do not set `PORT`.** Render injects it, and `src/config/env.ts` reads it.
> Setting it manually can bind the wrong port and fail the health check.

> **All three of `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY` are `required`
> in `src/config/env.ts`.** A missing one crashes the service at boot with
> `Missing required environment variable: <NAME>`.

4. Click **Create Web Service**. Watch the **Logs** tab for the first build.

A healthy first deploy ends with:

```
Applying migration `0001_init`
Seeded 20 movies. Movies in database: 20.
[server] FilmLog API listening on http://localhost:10000/api
```

---

## 3. Create the static frontend site

1. Dashboard → **New +** → **Static Site** → same repo.
2. Configure:

| Field | Value |
|---|---|
| **Name** | `filmlog-web` |
| **Branch** | `main` |
| **Root Directory** | `frontend` |
| **Build Command** | *(leave empty)* |
| **Publish Directory** | `.` |

3. Deploy. The site has no build step — it is plain HTML/CSS/JS.

### How the frontend finds the API

`frontend/config.js` decides the API URL at page load:

```js
window.FILMLOG_API_URL = isLocal
  ? 'http://localhost:8000/api'
  : 'https://filmlog-api.onrender.com/api';
```

`frontend/app.js` resolves it in this order:

1. `localStorage['filmlog_api_url']` — the in-app URL field, highest priority
2. `window.FILMLOG_API_URL` — from `config.js`
3. `http://localhost:8000/api` — last-resort fallback

**If your Render service is not named `filmlog-api`**, edit the production URL in
`frontend/config.js`, commit, and push. That is the only place to change it.

---

## 4. Verify the deployment

```bash
API=https://filmlog-api.onrender.com

# 1. Liveness
curl -s $API/api/health
# {"status":"ok","uptime":12.3}

# 2. Seed ran (expect 20)
curl -s $API/api/movies | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))"

# 3. Auth works end to end
curl -s -X POST $API/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.local","password":"secret123","username":"smoke"}'

TOKEN=$(curl -s -X POST $API/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.local","password":"secret123"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

# 4. Protected route accepts the token
curl -s $API/api/watchlist -H "Authorization: Bearer $TOKEN"

# 5. AI recommendation
curl -s -X POST $API/api/movies/recommend \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"film misteri dengan alur lambat"}'
```

Then open the static site and confirm the movie grid loads.

### Postman

Point the collection at production: change `baseUrl` in the **FilmLog Local**
environment to `https://filmlog-api.onrender.com`, then re-run. See
`docs/postman/README.md`.

---

## 5. Free tier limitations

These are real constraints of Render's free plan, not bugs in the app.

| Limitation | Impact |
|---|---|
| **Sleeps after 15 min idle** | First request after a sleep takes ~50 s (cold start). Subsequent requests are normal. |
| **Free Postgres expires after 30 days** | The database is **deleted** 30 days after creation. Re-create and re-deploy before then. |
| **750 instance hours / month** | A sleeping service uses none; plenty for a demo. |
| **5 GB bandwidth / month** | Fine for an assignment; heavy traffic gets suspended. |
| **No shell access** | You cannot `psql` into the instance. Use the **External** URL from your machine. |
| **Single instance** | No horizontal scaling. |

### Keeping it awake

Only if you need it: a scheduled ping every ~10 minutes prevents the spin-down.
Not recommended for grading — it burns instance hours and the DB still expires.

---

## 6. Redeploying

Render redeploys automatically on every push to `main`.

```bash
git push origin main   # triggers build → migrate deploy → seed → restart
```

The seed is idempotent, so pushing unrelated changes will not duplicate movies.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing required environment variable: X` | env var not set | Add it in **Environment**, redeploy |
| `tsc: not found` during build | devDependencies skipped | Use `npm ci --include=dev` |
| `P1000` / authentication failed | wrong `DATABASE_URL` | Use the **Internal** URL from the database's Info page |
| `P1001` / can't reach database | database and service in different regions | Recreate one so both match |
| `prisma: error: Cannot find schema` | Root Directory misconfigured | Reset Root Directory to the repo root for the API |
| `Error: Cannot find module '.../dist/server.js'` | build did not run `tsc` | Check the build logs for a TypeScript error |
| Health check failing | wrong `PORT` | Remove any custom `PORT` env var |
| Seed says `data/movies.json` missing | Root Directory is not the repo root | Fix Root Directory; `seed.ts` resolves `../data/movies.json` |
| 502 on `/api/movies/recommend` | invalid or missing Gemini key | Check `GEMINI_API_KEY`; see the error log |
| 503 on recommend | Gemini rate limit | Retry shortly |
| Frontend hits `localhost` in production | `config.js` not deployed | Confirm it is loaded before `app.js` |

---

## 8. Deploying from a different branch

This guide assumes `main`. To deploy `testing` instead, change the **Branch**
field on both services. Nothing else changes — the files are identical after the
fast-forward.

---

## Appendix — the migration baseline

The project originally used `prisma db push`, so there was no migration history.
To move to `prisma migrate deploy`, a baseline was generated once:

```bash
mkdir -p prisma/migrations/0001_init
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma \
  --script > prisma/migrations/0001_init/migration.sql
printf 'provider = "postgresql"\n' > prisma/migrations/migration_lock.toml

# Mark it applied on the existing local database, which already had the tables.
npx prisma migrate resolve --applied 0001_init
npx prisma migrate status
```

Committed files:

```
prisma/migrations/
├── 0001_init/migration.sql      # CREATE SCHEMA, 4 tables, indexes, FKs
└── migration_lock.toml          # provider = "postgresql"
```

On a fresh Render database, `npx prisma migrate deploy` runs that SQL from
scratch. Verified locally by applying it to an empty database and seeding it.
