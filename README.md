# FilmLog — Movie Watchlist & Review API

A RESTful API for tracking films: authenticate, browse a curated catalogue, build a
watchlist, record what you've watched with a rating and review, and ask an LLM for a
recommendation drawn **only** from the local catalogue.

Built with **TypeScript + Express 5 + Prisma 7 + PostgreSQL**. No ORM shortcuts, no
validation library, no auth framework — password hashing, JWT handling and input
validation are all implemented by hand in this repository.

```
120 tests passing  ·  29 suites  ·  13 endpoints  ·  4 models
```

---

## Table of contents

1. [Overview](#1-overview)
2. [Tech stack](#2-tech-stack)
3. [How it works](#3-how-it-works)
4. [Folder structure](#4-folder-structure)
5. [Data model](#5-data-model)
6. [Local setup, step by step](#6-local-setup-step-by-step)
7. [API reference](#7-api-reference)
8. [Error codes](#8-error-codes)
9. [AI recommendation](#9-ai-recommendation)
10. [Testing](#10-testing)
11. [Troubleshooting](#11-troubleshooting)
12. [Further documentation](#12-further-documentation)

---

## 1. Overview

FilmLog is a single Express application serving a JSON API under `/api`. A zero-build
vanilla-JS frontend in `frontend/` consumes it.

**What the API does**

| Capability | Endpoints |
|---|---|
| Authentication — register, login, current user | 3 |
| Movie catalogue — list, filter, search, detail | 3 |
| AI recommendation from the local catalogue | 1 |
| Watchlist — list, add, remove | 3 |
| Watched + reviews — list, record/update, delete | 3 |
| Health check | 1 |

**Design commitments**

- **Layered.** Routes declare the HTTP contract, controllers translate, services own
  the business rules. A controller never imports Prisma; a service never imports Express.
- **Hand-rolled security.** bcrypt hashing, signed JWTs, and a dependency-free validator
  with body/query/param whitelisting.
- **One error shape.** Every failure returns `{ "message": "..." }`, mapped centrally.
- **Semantic status codes.** 400 for bad input, 401 for unauthenticated, 403 for
  not-the-owner, 404 for missing, 409 for conflict, 422 for a semantically impossible
  request. Each has a test.

---

## 2. Tech stack

### Runtime & language

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Node.js ≥ 22.18** | Native `fetch`, stable `node:test`, ESM |
| Language | **TypeScript 7** (`strict: true`) | Type safety across all layers |
| Module system | **NodeNext / ESM** | Native ES modules, `.js` in import specifiers |

### Application

| Layer | Choice | Version | Why |
|---|---|---|---|
| HTTP framework | **Express** | 5.3 | Express 5 forwards rejected promises to the error handler — no `try/catch` in controllers |
| Database | **PostgreSQL** | 16+ | Native `text[]` for `genres` and `cast` |
| ORM | **Prisma Client** | 7.10 | Typed queries, relations, migrations |
| DB driver | **`@prisma/adapter-pg` + `pg`** | 7.10 / 8.23 | Prisma 7 **requires** a driver adapter — bare `new PrismaClient()` throws |
| Password hashing | **bcryptjs** | 3.0 | Pure-JS, no native build step |
| Tokens | **jsonwebtoken** | 9.0 | HS256 signing and verification |
| LLM | **@google/genai** | 3.0 | Gemini SDK with structured-output support |
| CORS | **cors** | 2.8 | The frontend is served from a different origin |
| Env loading | **dotenv** | 18.0 | Loads `.env` into `process.env` at boot |

### Tooling

| Purpose | Tool |
|---|---|
| Dev server | `tsx watch` (no build step, instant reload) |
| Type checking | `tsc --noEmit` |
| Testing | built-in `node:test` via `tsx` — **no test framework dependency** |
| Migrations | Prisma Migrate |
| Seeding | `prisma/seed.ts` via `prisma7.config.ts` |

> **Notable absences**, all deliberate: no Zod/Joi, no Passport, no `supertest`, no
> Jest/Vitest, no Next.js. Validation, auth and the integration test harness are all
> written against Node/Express primitives.

---

## 3. How it works

### Request lifecycle

Every request descends the same fixed pipeline. Nothing skips a layer.

```
POST /api/watchlist        { "movieId": 1 }        Authorization: Bearer <token>
  │
  ├─ app.ts               cors()           → CORS headers
  │                       express.json()   → parse, 100 kb cap (413 if exceeded)
  │
  ├─ routes/index.ts      api.use("/watchlist", requireAuth, watchlistRoutes)
  │
  ├─ auth.middleware.ts   extractToken()   → 401 if missing / malformed
  │                       jwt.verify()     → 401 if invalid / expired
  │                       user lookup      → 401 if the account was deleted
  │                       req.user = { id }
  │
  ├─ validate.middleware  runShape()       → 400 with per-field errors
  │                       req.body ← whitelisted keys only
  │
  ├─ watchlist.controller currentUserId() → service call
  │
  ├─ watchlist.service    assertMovieExists() → 404
  │                       uniqueness check    → 409
  │                       prisma.create()     → include movie
  │                       flatten → { ...movie, movieId, createdAt }
  │
  └─ controller           res.status(201).json(item)


  Any HttpError  ─────────────► error.middleware.ts  → { message }
  No route matched ───────────► notFound.middleware → 404
```

### The dependency rule

Dependencies point **downward only**:

```
routes → middlewares → controllers → services → config/prisma → PostgreSQL
```

Verified constraints:

| Rule | Enforced by |
|---|---|
| Controllers never import Prisma | Nothing in `src/controllers/` imports `config/prisma` |
| Routes never import services | Routes import controllers + middlewares only |
| Services never import Express | Only `HttpError` crosses the boundary |
| One database entry point | All 7 consumers import the `prisma` singleton |
| Errors converge in one place | `throw HttpError` anywhere; caught only in `error.middleware.ts` |

### Two response shapes, on purpose

The frontend reads these objects differently, so the API mirrors it:

```jsonc
// GET /api/watchlist — FLAT
{ "id": 1, "title": "Inception", "year": 2010, ..., "movieId": 1, "createdAt": "..." }

// GET /api/watched — NESTED
{ "id": "uuid", "rating": 5, "review": "...", "createdAt": "...",
  "userId": "uuid", "movieId": 1,
  "movie": { "id": 1, "title": "Inception", ... } }
```

---

## 4. Folder structure

```
movieapi-gdg/
├── src/                      application source
├── prisma/
│   ├── schema.prisma         data model (4 models)
│   ├── seed.ts               idempotent catalogue loader, validates JSON first
│   └── migrations/
│       ├── 0001_init/        baseline SQL migration
│       └── migration_lock.toml
├── data/
│   ├── movies.json           20 curated films (source of truth for the seed)
│   └── seed.sql              equivalent plain-SQL inserts
├── tests/
│   ├── unit/                 46 tests — no database
│   └── integration/          74 tests — real HTTP against a real database
├── scripts/
│   └── run-tests.mjs         creates the throwaway test DB, then runs the suite
├── frontend/                 zero-build vanilla-JS client
│   ├── index.html
│   ├── app.js
│   └── config.js             points the client at the API
├── docs/
│   ├── DEPLOY-RENDER.md      deployment runbook
│   └── postman/              collection, environment, README
├── prisma7.config.ts         Prisma CLI config (schema path, seed command)
├── tsconfig.json             strict, NodeNext
├── .env.example              documented template
└── README.md
```

### `src/` in detail

```
src/
├── server.ts                 process entry point: bind port, graceful shutdown
├── app.ts                    Express wiring: CORS, JSON, routes, 404, error handler
│
├── config/                   singletons, constructed once at import
│   ├── env.ts                typed, validated environment. Fails fast at boot
│   ├── prisma.ts             the PrismaClient + pg pool (capped at 5)
│   └── gemini.ts             the GoogleGenAI client
│
├── routes/                   HTTP surface: verbs, paths, guards, validation shapes
│   ├── index.ts              mounts all feature routers under /api + /health
│   ├── auth.routes.ts        POST /register, POST /login, GET /me
│   ├── movie.routes.ts       GET /, POST /recommend, GET /:id  (order matters)
│   ├── watchlist.routes.ts   GET /, POST /, DELETE /:movieId
│   └── watched.routes.ts     GET /, POST /, DELETE /:id
│
├── middlewares/              cross-cutting guards
│   ├── auth.middleware.ts    JWT verification + account existence → req.user
│   ├── validate.middleware.ts hand-rolled validators + body/query/param runner
│   ├── notFound.middleware.ts terminal 404 for unmatched /api paths
│   └── error.middleware.ts   maps every thrown error to one JSON shape
│
├── controllers/              HTTP ⇄ domain translation, no business logic
│   ├── auth.controller.ts
│   ├── movie.controller.ts
│   ├── watchlist.controller.ts
│   └── watched.controller.ts
│
├── services/                 all business rules live here
│   ├── auth.service.ts       bcrypt hashing, JWT issuance, public-user projection
│   ├── movie.service.ts      catalogue filters, detail, assertMovieExists
│   ├── watchlist.service.ts  flat shape, duplicate detection, removal
│   ├── watched.service.ts    nested shape, upsert, 404/403/204 ownership flow
│   └── recommendation.service.ts  Gemini prompt, schema, id re-validation → 422
│
├── types/                    compile-time only, no runtime output
│   ├── express.d.ts          augments Request with user?: { id: string }
│   └── validators.ts         Validator<T>, ValidationResult<T>, ValidatorShape<T>
│
└── utils/
    └── HttpError.ts          Error subclass carrying an HTTP status code
```

#### What each layer is for

| Layer | Responsibility | Must never |
|---|---|---|
| `server.ts` | Bind the port; close the DB on `SIGINT`/`SIGTERM` | Contain routes or logic |
| `app.ts` | Compose middleware in the correct order | Touch the database |
| `routes/` | Declare path, verb, guards, validation shape | Contain logic or SQL |
| `middlewares/` | Authenticate, validate, normalise errors | Know about a specific feature |
| `controllers/` | Read validated input, call one service, pick a status code | Import Prisma or `try/catch` |
| `services/` | Enforce every business rule and ownership check | Import Express or read `req` |
| `config/` | Build singletons once | Be imported by `routes/` |
| `types/` | Describe types | Emit runtime code |
| `utils/` | Shared primitives | Depend on any other layer |

#### Two details worth knowing

**Auth is mounted at the router level**, not per route:

```ts
// src/routes/index.ts
api.use("/watchlist", requireAuth, watchlistRoutes);
api.use("/watched",   requireAuth, watchedRoutes);
```

Any route added to those files is protected by default — you cannot forget.

**Route order is load-bearing**:

```ts
// src/routes/movie.routes.ts
router.post("/recommend", ...);   // MUST come before…
router.get("/:id", ...);          // …otherwise ":id" matches "recommend"
```

---

## 5. Data model

Four models, four cascading foreign keys, two composite unique constraints.

```
┌──────────────┐
│     User     │
├──────────────┤
│ id        PK │ uuid
│ username     │
│ email     UQ │ unique
│ password     │ bcrypt hash
│ createdAt    │
└──────┬───────┘
       │ 1
       ├──────────────────────┬──────────────────────┐
       │ N                    │ N
┌──────▼────────┐      ┌──────▼────────┐
│   Watchlist   │      │    Review     │
├───────────────┤      ├───────────────┤
│ id         PK │      │ id         PK │ uuid
│ userId     FK │      │ userId     FK │
│ movieId    FK │      │ movieId    FK │
│ createdAt     │      │ rating  1..5  │
└──────┬────────┘      │ review        │
       │ N             │ createdAt     │
       │               └──────┬────────┘
       │ N                    │ N
┌──────▼──────────────────────▼───┐
│             Movie               │
├─────────────────────────────────┤
│ id         PK                   │ Int (1..20)
│ title, year, director           │
│ genres     String[]             │ Postgres text[]
│ rating     Float                │
│ duration, synopsis              │
│ poster_url                      │
│ cast       String[]             │
│ createdAt                       │
└─────────────────────────────────┘

@@unique([userId, movieId]) on Watchlist  → one entry per movie per user
@@unique([userId, movieId]) on Review     → one review per movie per user
onDelete: Cascade on all FKs              → deleting a user removes their rows
```

Notes:

- `Movie.id` is a plain `Int` (1–20) because the catalogue ships with fixed ids. Every
  other model uses `@default(uuid())`.
- `Review` uses `upsert` on its composite key, so re-rating a film **updates** the
  existing review instead of returning 409. `Watchlist` returns 409 on duplicates,
  because "already in your watchlist" is a conflict, not an update.

### The 20 seeded films

| id | title | year | director |
|---|---|---|---|
| 1 | Inception | 2010 | Christopher Nolan |
| 2 | Parasite | 2019 | Bong Joon-ho |
| 3 | The Dark Knight | 2008 | Christopher Nolan |
| 4 | Interstellar | 2014 | Christopher Nolan |
| 5 | Pulp Fiction | 1994 | Quentin Tarantino |
| 6 | Spirited Away | 2001 | Hayao Miyazaki |
| 7 | Whiplash | 2014 | Damien Chazelle |
| 8 | The Matrix | 1999 | Lana & Lilly Wachowski |
| 9 | Spider-Man: Into the Spider-Verse | 2018 | Persichetti / Ramsey / Rothman |
| 10 | The Godfather | 1972 | Francis Ford Coppola |
| 11 | Fight Club | 1999 | David Fincher |
| 12 | Alien | 1979 | Ridley Scott |
| 13 | WALL-E | 2008 | Andrew Stanton |
| 14 | Memento | 2000 | Christopher Nolan |
| 15 | Joker | 2019 | Todd Phillips |
| 16 | Blade Runner 2049 | 2017 | Denis Villeneuve |
| 17 | The Shawshank Redemption | 1994 | Frank Darabont |
| 18 | Dune | 2021 | Denis Villeneuve |
| 19 | Oppenheimer | 2023 | Christopher Nolan |
| 20 | Goodfellas | 1990 | Martin Scorsese |

Available genres: `Action, Adventure, Animation, Biography, Comedy, Crime, Drama,
Family, Fantasy, History, Horror, Music, Mystery, Sci-Fi, Thriller`.

---

## 6. Local setup, step by step

Everything below runs on `localhost`. No cloud account required.

### Prerequisites

| Requirement | Check | Minimum |
|---|---|---|
| Node.js | `node -v` | 22.18 |
| npm | `npm -v` | bundled with Node |
| PostgreSQL | `psql --version` | 14 |

You need a PostgreSQL server running locally. Any installation works — system package,
Postgres.app, or Docker:

```bash
docker run -d --name filmlog-db \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:16
```

### Step 1 — Install dependencies

```bash
npm install
```

### Step 2 — Create the database

```bash
createdb -h localhost -U postgres watchlist_db
```

If `createdb` is unavailable, use `psql`:

```bash
psql -h localhost -U postgres -c "CREATE DATABASE watchlist_db;"
```

### Step 3 — Create your `.env`

```bash
cp .env.example .env
```

Now **edit `.env`** and point `DATABASE_URL` at your local database. The template ships
with a hosted example, so replace that line and delete the comment block above it:

```dotenv
PORT=8000

# Local PostgreSQL
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/watchlist_db?schema=public"

# Signs JWTs. Use any long random string locally.
JWT_SECRET="dev-only-change-me-please-32-chars-min"

# Get one free at https://aistudio.google.com/apikey
GEMINI_API_KEY="your-google-ai-studio-key"

# Used only by `npm test` (see step 7)
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/watchlist_test"
```

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `8000` | Validated; a non-numeric value aborts boot |
| `DATABASE_URL` | **yes** | — | Boot fails with `Missing required environment variable` if absent |
| `JWT_SECRET` | **yes** | — | Any long random string |
| `GEMINI_API_KEY` | **yes** | — | Required even if you never call `/recommend`, because `env.ts` validates at import |
| `JWT_EXPIRES_IN` | no | `7d` | Any `jsonwebtoken` duration string |
| `GEMINI_MODEL` | no | `gemini-3.5-flash-lite` | Override if your key lacks access |
| `DB_POOL_MAX` | no | `5` | Connection pool ceiling |
| `TEST_DATABASE_URL` | no | — | Only read by `scripts/run-tests.mjs` |

> `.env` is gitignored. Never commit it.

### Step 4 — Create the schema

```bash
npm run db:push
```

This syncs `prisma/schema.prisma` into the database: four tables, four cascading foreign
keys, two composite unique constraints.

<details>
<summary>Alternative: apply the tracked migration instead</summary>

```bash
npm run db:migrate      # prisma migrate deploy
```

This applies `prisma/migrations/0001_init/migration.sql` and records it in
`_prisma_migrations`. Prefer it when you want the schema history to match the repo.

Do not mix the two approaches on the same database.
</details>

### Step 5 — Seed the catalogue

```bash
npm run db:seed
```

```
Seeded 20 movies. Movies in database: 20.
```

The seed is **idempotent** — it `upsert`s each film by id, so running it repeatedly is
safe and never duplicates rows. It validates `data/movies.json` (types, required fields,
unique ids) before writing anything, so a malformed file fails with a readable message
rather than a half-written table.

### Step 6 — Start the server

```bash
npm run dev
```

```
[server] FilmLog API listening on http://localhost:8000/api
[server] Environment: development
```

Verify:

```bash
curl -s localhost:8000/api/health
# {"status":"ok","uptime":1.23}

curl -s localhost:8000/api/movies | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))"
# 20
```

### Step 7 — Run the tests (optional but recommended)

```bash
npm test
```

```
[tests] Target database: localhost:5432/watchlist_test
[tests] Recreated database watchlist_test
[tests] Applying schema and seeding...
# tests 120
# suites 29
# pass 120
# fail 0
```

`npm test` **drops and recreates** `watchlist_test` on every run. Your development
database is never touched. The runner refuses to proceed unless the host is `localhost`
and the database name ends in `_test` — a guard against pointing it at a remote server.

Do **not** create the test database manually; the runner creates it.

### Step 8 — Open the frontend

In a second terminal:

```bash
cd frontend
python3 -m http.server 3000
```

Open <http://localhost:3000>. `frontend/config.js` already points at
`http://localhost:8000/api` when the page is served from localhost, so nothing to
configure. If you changed `PORT`, click the gear icon in the app and set the API base
URL (it must include `/api`).

### Smoke test the whole flow

```bash
BASE=http://localhost:8000/api

# Register
curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"you@test.local","password":"secret123","username":"You"}'

# Login and capture the token
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"you@test.local","password":"secret123"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).token))")

# Add a film to your watchlist
curl -s -X POST $BASE/watchlist -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"movieId":1}'

# Read it back
curl -s $BASE/watchlist -H "Authorization: Bearer $TOKEN"
```

### Command reference

| Command | What it does |
|---|---|
| `npm run dev` | `tsx watch` — reload on save |
| `npm run build` | `prisma generate && tsc` → `dist/` |
| `npm start` | Run the compiled build (`dist/server.js`) |
| `npm run typecheck` | Type-check `src/`, `prisma/`, `tests/` |
| `npm test` | Full suite against a throwaway database |
| `npm run test:unit` | 46 unit tests, no database needed |
| `npm run db:push` | Sync schema without a migration file |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Load the 20 films (idempotent) |
| `npm run db:baseline` | Mark `0001_init` as already applied |

---

## 7. API reference

Base URL: `http://localhost:8000/api`

🔒 = requires `Authorization: Bearer <token>`

| Method | Path | Auth | Body / Query | Success |
|---|---|---|---|---|
| GET | `/health` | — | — | `200` |
| POST | `/auth/register` | — | `{ email, password, username }` | `201` |
| POST | `/auth/login` | — | `{ email, password }` | `200` |
| GET | `/auth/me` | 🔒 | — | `200` |
| GET | `/movies` | — | `?genre=` `?search=` | `200` |
| POST | `/movies/recommend` | — | `{ prompt }` | `200` |
| GET | `/movies/:id` | — | — | `200` |
| GET | `/watchlist` | 🔒 | — | `200` |
| POST | `/watchlist` | 🔒 | `{ movieId }` | `201` |
| DELETE | `/watchlist/:movieId` | 🔒 | — | `204` |
| GET | `/watched` | 🔒 | — | `200` |
| POST | `/watched` | 🔒 | `{ movieId, rating, review }` | `201` |
| DELETE | `/watched/:id` | 🔒 | — | `204` |

**Field rules** (enforced before any handler runs):

| Field | Validator | Rule |
|---|---|---|
| `email` | `isEmail` | trimmed + lowercased, one `@`, a dot in the domain, ≤ 254 chars |
| `password` | `isPassword` | 6–128 chars, **not** trimmed |
| `username` | `isString(1, 50)` | trimmed, 1–50 chars |
| `movieId` | `isInt(1)` | whole number ≥ 1 |
| `rating` | `isInt(1, 5)` | whole number 1–5 |
| `review` | `isText(1, 2000)` | trimmed, 1–2000 chars |
| `prompt` | `isString(3, 1000)` | trimmed, 3–1000 chars |
| `:id` (watched) | `isUuid` | valid UUID |
| `?genre` `?search` | `optional(isString)` | ≤ 50 / ≤ 100 chars |

**Alias support.** The frontend sends some snake_case keys. The API canonicalises them
before validation: `movie_id` → `movieId`, `opinion` → `review`.

---

## 8. Error codes

Every error leaves the API as one of two shapes:

```jsonc
{ "message": "Movie not found" }                                    // always
{ "message": "Password is too short (at least 6 characters)",
  "errors": ["password: is too short (at least 6 characters)"] }    // validation only
```

`message` is human-readable and always present. `errors` appears only for `400`
validation failures, listing **every** bad field at once.

### Status matrix

| Status | When | Example message |
|---|---|---|
| `200` | Successful read, login, recommendation | — |
| `201` | Resource created | — |
| `204` | Deleted, no body | *(empty)* |
| `400` | Invalid body, query or param; malformed JSON; unparseable URL | `Password is too short (at least 6 characters)` |
| `401` | Missing/malformed/invalid/expired token; wrong credentials | `Missing or malformed Authorization header` |
| `403` | Authenticated, but not the owner | `You can only modify your own reviews` |
| `404` | Film, watchlist entry or review not found | `Movie not found` |
| `409` | Conflict with existing state | `Movie is already in your watchlist` |
| `413` | Body exceeds 100 kb | `Request body is too large` |
| `422` | Well-formed request that cannot be processed | `The AI recommended a movie outside the catalogue; please retry` |
| `500` | Unexpected server bug | `Internal server error` |
| `502` | AI provider returned an unusable response | `The AI service returned malformed JSON` |
| `503` | A dependency is unavailable | `Database is currently unavailable` |

### Where each code comes from

The mapping is centralised in `src/middlewares/error.middleware.ts`. Handlers just
`throw new HttpError(status, message)`.

| Source | Mapped to |
|---|---|
| `HttpError` thrown anywhere | `error.status` verbatim |
| Malformed JSON body | `400` |
| Body over 100 kb | `413` |
| `URIError` (bad percent-encoding) | `400` |
| Prisma `P2002` (unique violation) | `409`, naming the colliding field |
| Prisma `P2003` (FK violation) | `400` |
| Prisma `P2000` (value too long) | `400` |
| Prisma `P2011` (required value null) | `400` |
| Prisma `P2014` (relation would break) | `409` |
| Prisma `P2025` (record not found) | `404` |
| Prisma validation error (a coding bug) | `500` |
| Prisma init error (DB unreachable) | `503` |
| Anything else | `500`, with `detail` only when `NODE_ENV !== production` |
| No route matched | `404 Route not found: GET /api/xyz` |

### Three deliberate distinctions

**400 vs 422.** `400` means the client sent something malformed. `422` is reserved for
exactly one case: the request is well-formed, but the AI named a film that isn't in the
catalogue. Validation never returns 422.

**401 vs 403.** `401` means "we don't know who you are". `403` means "we know, and it
isn't yours". Conflating them hides bugs, so they are never mixed.

**401 before 400.** `requireAuth` runs before `validate`. An anonymous caller therefore
gets `401`, never a hint about which fields are invalid.

---

## 9. AI recommendation

`POST /api/movies/recommend` — ask Gemini for a film, get back a catalogue id plus a
justification.

### Request

```json
{ "prompt": "film sci-fi yang bikin mikir" }
```

### Response `200`

```json
{
  "movie_id": 1,
  "reasoning": "Inception adalah film fiksi ilmiah yang sangat pas untuk Anda karena alur ceritanya berpusat pada konsep rumit dan berlapis tentang mimpi. ...",
  "movie": { "id": 1, "title": "Inception", "year": 2010, "...": "..." }
}
```

The full `movie` object is included, so a client needs no second request.

### How the prompt is built

`src/services/recommendation.service.ts` composes a single prompt with four rules and
the **entire catalogue injected as JSON** (id, title, year, director, genres, synopsis —
not the whole row, to keep the prompt small):

```
You are a movie recommendation engine for a small curated catalogue.

RULES:
1. Choose exactly ONE movie from the CATALOGUE below.
2. `movie_id` MUST be an id that appears in the catalogue. Never invent one.
3. If nothing is a perfect match, pick the closest one and explain the compromise.
4. `reasoning` must be 2-4 sentences in the same language as the user's request.

CATALOGUE:
[ …20 films as JSON… ]

USER REQUEST:
film sci-fi yang bikin mikir
```

| Rule | Guards against |
|---|---|
| 1 · one film, from the catalogue | the model returning a list or a summary instead of a pick |
| 2 · id must exist, never invent | hallucinated ids |
| 3 · closest match, explain the compromise | silently pretending a perfect match exists |
| 4 · the user's language | English answers to Indonesian prompts |

Because the catalogue is injected as text, the recommendation is grounded in **this
database**, not in the model's training memory. Changing `data/movies.json` and
re-seeding changes what the model can recommend.

### Structured output

The model cannot return prose. The call constrains it:

```ts
config: {
  responseMimeType: "application/json",
  responseSchema: RESPONSE_SCHEMA,   // { movie_id: integer, reasoning: string }
  temperature: 0.4,                  // consistency over creativity
}
```

### The hard guard

The model's answer is **re-validated against the database** before it reaches the client:

```ts
const movie = await prisma.movie.findUnique({ where: { id: parsed.movie_id } });
if (!movie) {
  throw new HttpError(422, "The AI recommended a movie outside the catalogue; please retry");
}
```

So a hallucinated id becomes a clean `422`, never a broken recommendation. In practice
this is unreachable — the schema constrains the model and rule 2 tells it not to
invent — but it exists as a safety net.

### Failure mapping

| Condition | Status |
|---|---|
| Empty response from the model | `502` |
| Response is not valid JSON | `502` |
| `movie_id` missing or not an integer | `502` |
| `reasoning` missing or empty | `502` |
| API key rejected | `502` |
| Configured model unavailable | `502` |
| Rate limited / quota exhausted | `503` |
| Catalogue is empty (unseeded) | `503` |
| Returned id is not in the catalogue | `422` |

### Example: the compromise path

Prompt: `film horor Jepang yang bikin merinding tapi ada drama keluarganya`

There is no Japanese horror film in the catalogue. Observed response:

```json
{
  "movie_id": 12,
  "reasoning": "Meskipun katalog kami tidak memiliki film horor asal Jepang, Alien adalah pilihan terbaik jika Anda mencari pengalaman sinematik yang benar-benar bikin merinding dengan ketegangan ..."
}
```

Rule 3 working: the model picked the closest match and stated the compromise up front
instead of inventing a film.

### Notes

- The endpoint is **stateless** — no conversation history, one prompt in, one JSON out.
- It is **not** RAG or vector search. Twenty rows are serialised straight into the
  prompt.
- Each call takes roughly 1.5–3 s.

---

## 10. Testing

```bash
npm test           # 120 tests, 29 suites
npm run test:unit  # 46 tests, no database required
```

Built on Node's built-in `node:test` — there is no test framework dependency.

| Suite | Tests | Covers |
|---|---|---|
| `unit/validate` | 25 | every primitive validator, including edge cases |
| `unit/validation-middleware` | 8 | whitelisting, alias resolution, multi-field errors |
| `unit/error-handler` | 13 | every Prisma code → status mapping |
| `integration/auth` | 19 | register, login, token verification, deleted accounts |
| `integration/movies` | 16 | listing, filters, search, detail, recommendation |
| `integration/watchlist` | 14 | add, list, remove, duplicate, isolation between users |
| `integration/watched` | 13 | reviews, upsert, 404/403/204 ownership flow |
| `integration/status-codes` | 10 | the full status matrix, password-hash leakage, injection |
| `integration/health` | 2 | liveness |

How `npm test` works:

1. Drops and recreates `watchlist_test` (guaranteed clean slate).
2. Pushes the Prisma schema into it.
3. Runs the **real** seed script so tests see the true catalogue.
4. Runs `node:test` through `tsx` with `DATABASE_URL` pointed at the test database.

Safety: the runner refuses to run if `NODE_ENV=production`, if the host is not
`localhost`, or if the database name does not end in `_test`.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing required environment variable: DATABASE_URL` | no `.env`, or the key is blank | `cp .env.example .env` and fill it in |
| `Invalid PORT: NaN` | `PORT` is set but not a number | remove it or set `PORT=8000` |
| `PrismaClientInitializationError` / `ECONNREFUSED` → `503` | Postgres isn't running | start the server: `sudo systemctl start postgresql` |
| `new PrismaClient()` throws about a missing adapter | Prisma 7 requires a driver adapter | use `src/config/prisma.ts`; never construct the client directly |
| `Cannot find package 'dotenv'` | `dotenv` was pruned from `node_modules` | `npm install` |
| `relation "Movie" does not exist` | schema not applied | `npm run db:push` |
| `/api/movies` returns `[]` | database not seeded | `npm run db:seed` |
| `422` from `/recommend` | the model named an id outside the catalogue | retry; it is a safety net |
| `502`/`503` from `/recommend` | bad key, wrong model name, or quota | check `GEMINI_API_KEY` and `GEMINI_MODEL` |
| `npm test` refuses to run | target isn't local or doesn't end in `_test` | set `TEST_DATABASE_URL` to `localhost` |
| Frontend shows a red connection error | wrong API base URL | it must include `/api`; check the gear icon |
| `prisma migrate deploy` says "already in sync" | schema already applied | nothing to do |

---

## 12. Further documentation

| File | Contents |
|---|---|
| `docs/postman/README.md` | how to import and run the 29-request collection, including all six error statuses |
| `docs/postman/FilmLog-API.postman_collection.json` | 7 folders, saved examples, auto-captured variables |
| `docs/postman/FilmLog-Local.postman_environment.json` | `baseUrl` and runtime variables |
| `docs/DEPLOY-RENDER.md` | deployment runbook for Render + a hosted PostgreSQL |
| `prisma/schema.prisma` | the authoritative data model |
| `src/routes/` | the authoritative route table |
| `frontend/README.md` | how to serve the frontend |

### Postman quick start

1. Postman → **Import** → drop both `.json` files from `docs/postman/`.
2. Select the **FilmLog Local** environment.
3. Confirm `baseUrl` is `http://localhost:8000`.
4. Collection → **Run** → **Run FilmLog API**.

Run the **whole collection**, in order — folders `03`–`05` consume `{{token}}`,
`{{movieId}}` and `{{reviewId}}` captured by `01`–`04`. Expect 30 requests, 63
assertions, 0 failures.

---

## Licence

Built for the GDGoC Backend Recruitment Task.
