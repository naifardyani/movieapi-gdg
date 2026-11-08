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
                                   │ DATABASE_URL
                                   │ (session pooler, port 5432, IPv4)
                                   ▼
                    ┌──────────────────────────────┐
                    │ Supabase (PostgreSQL 17)      │
                    │  project: lndohmeqdoiljbobrppe│
                    │  region: ap-southeast-1       │
                    └──────────────────────────────┘
```

The database lives on **Supabase**, not on Render. Render hosts only the API and
the static frontend.

---

## 0. Prerequisites

| Requirement | Check |
|---|---|
| Code pushed to GitHub | `git push origin main` |
| Node ≥ 22.18 locally | `node -v` |
| Render account | no credit card needed for the free tier |
| Supabase account | free plan, no credit card |
| Gemini API key | from Google AI Studio |

The repo must contain `prisma/migrations/`. Verify:

```bash
ls prisma/migrations
# 0001_init  migration_lock.toml
```

---

## 1. Create the Supabase project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Fill in:
   - **Name:** `filmlog`
   - **Database Password:** generate one and **store it somewhere safe** — you
     need it in the connection string, and it is not shown again
   - **Region:** **Southeast Asia (Singapore)** — `ap-southeast-1`

   > Pick Singapore. The pooler endpoint for this project is
   > `aws-0-ap-southeast-1.pooler.supabase.com`, so co-locating the Render
   > service in Singapore keeps the API→database hop in-region.

3. Wait for provisioning to finish (~2 minutes).

### Which connection string to copy

Click **Connect** at the top of the project dashboard. Supabase offers three
strings and **only one of them works from Render**:

| Option | Host & port | Reachable from Render | Use it? |
|---|---|---|---|
| **Session pooler** | `aws-0-<region>.pooler.supabase.com:5432` | ✅ IPv4 | **✅ YES** |
| Transaction pooler | `aws-0-<region>.pooler.supabase.com:6543` | ✅ IPv4 | ❌ No (see below) |
| Direct connection | `db.<ref>.supabase.co:5432` | ❌ **IPv6 only** | ❌ No |

**Why not the direct connection.** That host resolves to an IPv6 address unless
the project has the IPv4 add-on (Pro plan, ~$4/mo). Render has no outbound IPv6,
so the connection fails with a timeout even though the credentials are correct.
This is the single most common Supabase-on-Render mistake.

**Why not the transaction pooler.** Transaction mode returns the connection to
the pool after every transaction, so it cannot support prepared statements and
cannot run `prisma migrate deploy` or the seed. It would need `?pgbouncer=true`
and a separate direct URL just for migrations.

**Session mode supports both**, with one URL for everything.

### Percent-encode the password

The password goes inside a URL, so these characters must be encoded:

| Character | Encoded |
|---|---|
| `?` | `%3F` |
| `@` | `%40` |
| `#` | `%23` |
| `&` | `%26` |
| `/` | `%2F` |
| `%` | `%25` |

An unencoded `?` is especially nasty: it terminates the credentials section, so
the driver parses the rest as query parameters and fails with an opaque
`Invalid URL` or authentication error.

The finished `DATABASE_URL` looks like:

```
postgresql://postgres.<ref>:<encoded-password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
```

> **`uselibpqcompat=true` is required.** The installed `pg-connection-string`
> treats bare `sslmode=require` as an alias for `verify-full`, which rejects the
> pooler's certificate chain with `SELF_SIGNED_CERT_IN_CHAIN`. Adding
> `uselibpqcompat=true` restores libpq semantics (encrypt, do not verify the
> chain) and connects. Verified against this project.

### Applying the schema

From your machine, with the Supabase URL in `.env`:

```bash
npx prisma migrate deploy   # creates the 4 tables
npx prisma db seed          # inserts the 20 catalogue movies
```

Expect `Seeded 20 movies. Movies in database: 20.` Both commands are idempotent
and safe to re-run.

---

## 2. Create the API web service

> **Shortcut — use the Blueprint.** The repo contains `render.yaml`, which
> defines both services. Dashboard → **New +** → **Blueprint** → pick this repo
> → Render prompts for `DATABASE_URL` and `GEMINI_API_KEY`, generates
> `JWT_SECRET`, and creates everything below in one step. Skip to step 3 if you
> use it. The manual steps are kept for reference and for troubleshooting.

1. Dashboard → **New +** → **Web Service** → connect the GitHub repo.
2. Configure:

| Field | Value |
|---|---|
| **Name** | `filmlog-api` |
| **Region** | **Singapore** — match the Supabase region |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm ci --include=dev && npm run build` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/api/health` |
| **Instance Type** | **Free** |

> **Leave Pre-Deploy Command empty.** Render only offers it on **paid** web
> services; the free plan has no such field. The schema is already migrated and
> seeded on Supabase, so nothing needs to run before startup.

### Why `--include=dev`

With `NODE_ENV=production`, npm skips `devDependencies`. `typescript` and the
`prisma` CLI live there, so the build would fail with `tsc: not found`.
`--include=dev` installs them for the build only.

### Why `prisma generate` is in the build

`npm run build` is `prisma generate && tsc`, so the client is always regenerated
before compilation. `src/config/prisma.ts` imports the generated client; without
it the TypeScript build fails.

### Changing the schema later

Because `migrate deploy` cannot run on the free tier, apply migrations from your
machine before you push:

```bash
npx prisma migrate deploy   # against the Supabase DATABASE_URL in .env
npx prisma db seed          # only needed if data changed
git push origin main        # Render then rebuilds and restarts
```

Both commands are idempotent:

- `migrate deploy` applies only migrations not yet recorded in `_prisma_migrations`
- the seed uses `upsert`, and validates `data/movies.json` before writing

> On a paid instance you may instead set **Pre-Deploy Command** to
> `npx prisma migrate deploy && npx prisma db seed` and drop the manual step.

3. **Environment variables** (expand **Advanced**):

| Key | Value |
|---|---|
| `DATABASE_URL` | the **session pooler** string from step 1, including `?sslmode=require&uselibpqcompat=true` |
| `JWT_SECRET` | a long random string (e.g. `openssl rand -base64 48`) |
| `GEMINI_API_KEY` | your Google AI Studio key |
| `NODE_ENV` | `production` |
| `DB_POOL_MAX` | *(optional)* `5` — this is the code default |
| `GEMINI_MODEL` | *(optional)* `gemini-3.5-flash-lite` — this is the code default |

> **Do not set `PORT`.** Render injects it, and `src/config/env.ts` reads it.
> Setting it manually can bind the wrong port and fail the health check.

> **Do not set `TEST_DATABASE_URL` on Render.** The test suite is a local-only
> tool; nothing in the running API reads that variable.

> **All three of `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY` are `required`
> in `src/config/env.ts`.** A missing one crashes the service at boot with
> `Missing required environment variable: <NAME>`.

4. Click **Create Web Service**. Watch the **Logs** tab for the first build.

A healthy first deploy ends with:

```
[server] FilmLog API listening on http://localhost:10000/api
[server] Environment: production
```

Only those two lines are expected, because no migration runs during the build.
(The port `10000` is injected by Render; `src/server.ts` logs it verbatim.)

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

## 4b. Local development against Supabase

`.env` points at the same Supabase database as production, so there is one
database to reason about:

```bash
npm run dev          # http://localhost:8000, talks to Supabase
npm test             # talks to local Postgres (TEST_DATABASE_URL)
```

The test suite deliberately does **not** use Supabase. `scripts/run-tests.mjs`
drops and recreates its target database on every run, which would be
unrecoverable against a cloud project. It therefore reads `TEST_DATABASE_URL`,
falls back to `DATABASE_URL` only if that is unset, and **refuses to run at all
if the target host is not localhost**:

```
[tests] Refusing to run against non-local host: aws-0-ap-southeast-1.pooler.supabase.com
```

That guard is the thing that prevents an accidental wipe. Keep
`TEST_DATABASE_URL` pointing at `localhost`.

---

## 5. Free tier limitations

Two free tiers are in play: Render hosts the compute, Supabase hosts the
database. These are real constraints, not bugs in the app.

### Render (API + static site)

| Limitation | Impact |
|---|---|
| **Sleeps after 15 min idle** | First request after a sleep takes ~50 s (cold start). Subsequent requests are normal. |
| **750 instance hours / month** | A sleeping service uses none; plenty for a demo. |
| **5 GB bandwidth / month** | Fine for an assignment; heavy traffic gets suspended. |
| **No shell access** | You cannot `psql` into a Render instance — but you do not need to. Connect to Supabase from your laptop instead. |
| **Single instance** | No horizontal scaling. |

### Supabase (database)

| Limitation | Impact |
|---|---|
| **Pauses after 7 days of inactivity** | The project stops accepting connections until you click **Restore** in the dashboard. Restart takes a minute or two. |
| **500 MB database** | Far more than this app needs (20 movies, a few users), but the project turns **read-only** at the cap rather than growing. |
| **2 active projects** | A third requires the Pro plan or pausing another project. |
| **No automatic backups** | Do not treat this as the only copy of anything important. |

> **A paused project returns 503, not 500.** The app maps
> `PrismaClientInitializationError` to `503 Service Unavailable`, which is the
> semantically correct answer for "the database is temporarily unavailable".
> If you see 503 on a route that is not `/api/movies/recommend`, check the
> Supabase dashboard before debugging code.

### Why the database is better off on Supabase

Render's free PostgreSQL is **deleted 30 days after creation**, which is a poor
fit for an assignment that gets graded later. Supabase's free project only
*pauses* and is restorable, so the data survives.

### Keeping things awake

Only if you need it: a scheduled ping every ~10 minutes prevents Render's
spin-down. For Supabase, any query resets the 7-day inactivity timer, so a
health check that touches the database is sufficient. Not recommended for
grading — it burns Render instance hours.

---

## 6. Redeploying

Render redeploys automatically on every push to `main`.

```bash
git push origin main   # triggers build → migrate deploy → seed → restart
```

The seed is idempotent, so pushing unrelated changes will not duplicate movies.

### Deliberately changing the schema

Local development now points at the same Supabase database as production, so
there is one source of truth. To change the schema:

```bash
# Edit prisma/schema.prisma, then:
npx prisma migrate dev --name describe_the_change
git add prisma/migrations
git commit -m "migrate: describe_the_change"
git push origin main        # Render applies it via `migrate deploy`
```

`migrate dev` writes the migration and applies it immediately. Because `.env`
points at Supabase, this changes the real database — which is fine for a
solo assignment, and the reason the test suite is kept on a local throwaway
database instead.

> **Never run `prisma migrate reset` against Supabase.** It drops every table and
> wipes all users.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing required environment variable: X` | env var not set | Add it in **Environment**, redeploy |
| `tsc: not found` during build | devDependencies skipped | Use `npm ci --include=dev` |
| Connection **times out**, no error code | you used the Supabase **direct** string (`db.<ref>.supabase.co`) | Switch to the **session pooler** — the direct host is IPv6-only and Render has no outbound IPv6 |
| `SELF_SIGNED_CERT_IN_CHAIN` | `pg` treats `sslmode=require` as `verify-full` | Append `&uselibpqcompat=true` to `DATABASE_URL` |
| `Invalid URL` / auth failed with a correct password | unencoded special character in the password | Percent-encode it — an unencoded `?` is the classic offender |
| `Connection terminated unexpectedly` / prepared-statement errors | you used the transaction pooler on `:6543` | Switch to the session pooler on `:5432` |
| `P1000` / authentication failed | wrong password in `DATABASE_URL` | Re-copy the session pooler string; reset the password in Supabase if unsure |
| `P1001` / can't reach database | project is paused | Open the Supabase dashboard and **Restore** the project |
| Everything returns **503** | Supabase project paused or over quota | Restore the project / free up space |
| `prisma: error: Cannot find schema` | Root Directory misconfigured | Reset Root Directory to the repo root for the API |
| `Error: Cannot find module '.../dist/server.js'` | build did not run `tsc` | Check the build logs for a TypeScript error |
| Health check failing | wrong `PORT` | Remove any custom `PORT` env var |
| Seed says `data/movies.json` missing | Root Directory is not the repo root | Fix Root Directory; `seed.ts` resolves `../data/movies.json` |
| 502 on `/api/movies/recommend` | invalid or missing Gemini key | Check `GEMINI_API_KEY`; see the error log |
| 503 on recommend | Gemini rate limit, or paused database | Retry shortly; check the Supabase dashboard |
| Frontend hits `localhost` in production | `config.js` not deployed | Confirm it is loaded before `app.js` |
| `[tests] Refusing to run against non-local host` | `TEST_DATABASE_URL` points at Supabase | The suite drops its database; point it at local Postgres |

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

The baseline was then verified on a genuinely empty database, and later applied
to Supabase with `prisma migrate deploy`. It contains no version-specific
syntax, so it applies cleanly to both PostgreSQL 18 (local) and 17 (Supabase).

Committed files:

```
prisma/migrations/
├── 0001_init/migration.sql      # CREATE SCHEMA, 4 tables, indexes, FKs
└── migration_lock.toml          # provider = "postgresql"
```

On a fresh Render database, `npx prisma migrate deploy` runs that SQL from
scratch. Verified locally by applying it to an empty database and seeding it.
