/**
 * Watchlist tests.
 *
 * The watchlist response is FLATTENED (`{ movieId, createdAt, ...movie }`) to
 * match what frontend/app.js reads from a single item object.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient, createUser, deleteUser, startServer } from "../helpers/api.js";
import type { ApiClient, TestServer, TestUser } from "../helpers/api.js";

type WatchlistItem = {
  movieId: number;
  title: string;
  poster_url: string;
  createdAt: string;
};

describe("watchlist", () => {
  let server: TestServer;
  let api: ApiClient;
  let user: TestUser;

  before(async () => {
    server = await startServer();
    api = createClient(server.baseUrl);
    user = await createUser(api);
  });

  after(async () => {
    await deleteUser(user.id);
    await server.close();
  });

  it("requires authentication", async () => {
    assert.equal((await api.get("/watchlist")).status, 401);
  });

  it("starts empty", async () => {
    const response = await api.get("/watchlist", { token: user.token });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
  });

  it("adds a movie and returns the flattened shape", async () => {
    const response = await api.post("/watchlist", { movieId: 1 }, { token: user.token });

    assert.equal(response.status, 201);
    const item = response.body as WatchlistItem;

    assert.equal(item.movieId, 1);
    assert.equal(item.title, "Inception");
    assert.equal(typeof item.poster_url, "string");
    assert.equal(typeof item.createdAt, "string");
  });

  it("accepts the frontend's movie_id alias", async () => {
    const response = await api.post("/watchlist", { movie_id: 2 }, { token: user.token });

    assert.equal(response.status, 201);
    assert.equal((response.body as WatchlistItem).movieId, 2);
  });

  it("lists every added movie", async () => {
    const items = (await api.get("/watchlist", { token: user.token })).body as WatchlistItem[];

    assert.equal(items.length, 2);
    assert.deepEqual(items.map((item) => item.movieId).sort(), [1, 2]);
  });

  it("returns 409 when the movie is already in the watchlist", async () => {
    const response = await api.post("/watchlist", { movieId: 1 }, { token: user.token });

    assert.equal(response.status, 409);
    assert.match((response.body as { message: string }).message, /already/i);
  });

  it("returns 404 for a movie that does not exist", async () => {
    assert.equal(
      (await api.post("/watchlist", { movieId: 99999 }, { token: user.token })).status,
      404,
    );
  });

  it("returns 400 for a non-integer movieId", async () => {
    assert.equal(
      (await api.post("/watchlist", { movieId: "abc" }, { token: user.token })).status,
      400,
    );
  });

  it("returns 400 for movieId 0 or negative", async () => {
    for (const movieId of [0, -1]) {
      const response = await api.post("/watchlist", { movieId }, { token: user.token });
      assert.equal(response.status, 400, `movieId ${movieId} should be rejected`);
    }
  });

  it("returns 400 when movieId is missing", async () => {
    assert.equal((await api.post("/watchlist", {}, { token: user.token })).status, 400);
  });

  it("returns 400 for a malformed movieId in the path", async () => {
    assert.equal((await api.delete("/watchlist/abc", { token: user.token })).status, 400);
  });

  it("returns 204 when removing an entry", async () => {
    const response = await api.delete("/watchlist/1", { token: user.token });

    assert.equal(response.status, 204);
    assert.equal(response.text, "");
  });

  it("returns 404 when removing a movie that is not in the watchlist", async () => {
    assert.equal((await api.delete("/watchlist/1", { token: user.token })).status, 404);
  });

  it("isolates watchlists between users", async () => {
    const other = await createUser(api);

    assert.deepEqual((await api.get("/watchlist", { token: other.token })).body, []);

    // The first user still owns the entry created earlier in this block.
    const mine = (await api.get("/watchlist", { token: user.token })).body as WatchlistItem[];
    assert.equal(mine.length, 1);
    const [entry] = mine;
    assert.ok(entry);
    assert.equal(entry.movieId, 2);

    await deleteUser(other.id);
  });
});
