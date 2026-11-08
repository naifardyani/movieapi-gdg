# FilmLog API — Postman Collection

Importable Postman documentation for the FilmLog REST API, with saved example
responses and assertions for every endpoint and every error status the API is
designed to return.

## Files

| File | Purpose |
|---|---|
| `FilmLog-API.postman_collection.json` | 7 folders, 29 requests, assertions, saved examples |
| `FilmLog-Local.postman_environment.json` | `baseUrl` + runtime variables |

## Import

1. Open Postman → **Import** → drop both `.json` files (or **Import → Files**).
2. Select the **FilmLog Local** environment in the top-right environment picker.
3. Confirm `baseUrl` is `http://localhost:8000` (edit if you changed `PORT`).

## Requirements before running

```bash
# 1. Database must exist and be seeded (20 movies, ids 1..20)
npm run db:seed

# 2. Server must be running
npm run dev
```

The collection is a **client** of the API — it does not create the schema or
seed data. If `/api/health` returns a connection error, fix the server first.

## Running

**Whole collection:** open the collection → **Run** → **Run FilmLog API**.
Postman executes the folders in order; each folder depends on variables captured
by the previous one.

**Single request:** click it and press **Send**. Order matters only for requests
that consume captured variables (see the table below).

### Execution order and why it matters

```
00 · Health        no state
01 · Auth          saves {{token}}          (and {{emailA}})
02 · Movies        saves {{movieId}}
03 · Watchlist     uses {{token}}, {{movieId}}
04 · Watched       uses {{token}}; saves {{reviewId}}, {{tokenB}}
05 · Error Cases   uses everything above
06 · AI Recommend  no state (needs a live Gemini key)
```

## Environment variables

| Variable | Set by | Notes |
|---|---|---|
| `baseUrl` | environment file | `http://localhost:8000` |
| `token` | `01 · Auth → Login A` test script | bearer token for User A |
| `tokenB` | `04 · Watched → Login B` test script | bearer token for User B (403 case) |
| `movieId` | `02 · Movies → List all movies` | first catalogue id; defaults to `1` |
| `reviewId` | `04 · Watched → Record watched + review` | UUID used by the 403/204 cases |
| `emailA` | `Register A` pre-request script | `postman_a_<timestamp>@test.local` |
| `emailB` | `Register B` pre-request script | `postman_b_<timestamp>@test.local` |

Emails are timestamped so the collection can be re-run without hitting `409`.

## Folder reference

| Folder | Requests | Covers |
|---|---|---|
| `00 · Health` | 2 | liveness, service root |
| `01 · Auth` | 3 | register, login, current user |
| `02 · Movies` | 4 | list, `?genre=`, `?search=`, detail |
| `03 · Watchlist 🔒` | 3 | list, add, remove |
| `04 · Watched 🔒` | 4 | list, record review, register/login User B |
| `05 · Error Cases` | 12 | 400, 401, 403, 404, 409, 422 |
| `06 · AI Recommendation` | 1 | Gemini recommendation |

## Status-code matrix

Every row below has a real request in the collection.

| Status | Request in collection | Sample message |
|---|---|---|
| `200` | `01 → Login A` | — |
| `201` | `03 → Add movie to watchlist` | — |
| `204` | `05 → 204 · Cleanup — owner deletes own review` | *(empty body)* |
| `400` | `05 → 400 · Invalid body (password too short)` | `Password is too short (at least 6 characters)` |
| `400` | `05 → 400 · Non-numeric URL parameter` | `ID must be a whole number` |
| `400` | `05 → 400 · Malformed UUID` | `ID must be a valid UUID` |
| `401` | `05 → 401 · Missing token` | `Missing or malformed Authorization header` |
| `401` | `05 → 401 · Invalid token` | `Invalid or expired token` |
| `403` | `05 → 403 · Delete another user's review` | `You can only modify your own reviews` |
| `404` | `05 → 404 · Unknown movie` | `Movie not found` |
| `409` | `05 → 409 · Duplicate watchlist entry` | `Movie is already in your watchlist` |
| `422` | `05 → 422 · AI picked a movie outside the catalogue` | `The AI recommended a movie outside the catalogue; please retry` |
| `500` | *(not demoed — would require a server bug)* | `Internal server error` |
| `502` / `503` | *(not demoed — depend on Gemini/DB availability)* | upstream/dependency failure |

## Notes and caveats

**The 422 request is disabled.** Gemini reliably returns a real catalogue id, so
that request normally answers `200`. It is marked `disabled` in the collection
(checkbox unticked) and ships with a saved `422` example, so it documents the
status without affecting a Collection Runner pass. Its assertion also tolerates
`200` if you enable it manually. The error path itself is covered by the
unit/integration suite (`npm test`).

**A full run leaves two users behind.** `Register A` and `Register B` create
`postman_a_<timestamp>@test.local` and `postman_b_<timestamp>@test.local`.
There is no user-delete endpoint, so those rows stay in `watchlist_db`. Reviews
and watchlist rows created by the run are cleaned up by the `204 · Cleanup`
request and the `409` setup request's pre-request script.

**The `409` case is self-healing.** Its setup request deletes any leftover
watchlist row before inserting, so re-running the folder never produces a
false failure.

**`movieId` is read from the live catalogue**, not hardcoded, so the collection
still works if the seed ids ever change. The environment default is `1`.

**Responses are illustrative.** The saved examples were captured from a running
instance, so UUIDs, timestamps and `reasoning` text will differ on each run.
Field names and status codes will not.

## Related documentation

- `README.md` — project overview, API contract, run/test instructions
- `prisma/schema.prisma` — the ERD
- `src/routes/` — the authoritative route table
