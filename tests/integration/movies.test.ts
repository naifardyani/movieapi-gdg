/**
 * Movie catalogue tests.
 *
 * The catalogue is seeded from data/movies.json by the test runner, so these
 * assertions run against the same 20 movies the app ships with.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient, startServer } from "../helpers/api.js";
import type { ApiClient, TestServer } from "../helpers/api.js";

type Movie = {
  id: number;
  title: string;
  year: number;
  director: string;
  genres: string[];
  poster_url: string;
  synopsis: string;
};

describe("movies", () => {
  let server: TestServer;
  let api: ApiClient;

  before(async () => {
    server = await startServer();
    api = createClient(server.baseUrl);
  });

  after(async () => {
    await server.close();
  });

  describe("GET /movies", () => {
    it("returns the seeded catalogue ordered by id", async () => {
      const response = await api.get("/movies");

      assert.equal(response.status, 200);
      const movies = response.body as Movie[];
      assert.equal(movies.length, 20);

      const first = movies[0];
      const last = movies[19];
      assert.ok(first);
      assert.ok(last);
      assert.equal(first.id, 1);
      assert.equal(last.id, 20);
      assert.equal(first.title, "Inception");
    });

    it("exposes the field names the frontend consumes", async () => {
      const movies = (await api.get("/movies")).body as Movie[];
      const first = movies[0];
      assert.ok(first);

      for (const key of ["id", "title", "year", "director", "genres", "poster_url", "synopsis"]) {
        assert.ok(key in first, `missing field: ${key}`);
      }
    });

    it("filters by genre", async () => {
      const movies = (await api.get("/movies?genre=Sci-Fi")).body as Movie[];

      assert.ok(movies.length > 0);
      assert.ok(movies.every((movie) => movie.genres.includes("Sci-Fi")));
    });

    it("returns an empty array for a genre with no matches", async () => {
      const response = await api.get("/movies?genre=Documentary");
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, []);
    });

    it("searches titles case-insensitively", async () => {
      const movies = (await api.get("/movies?search=inception")).body as Movie[];

      assert.equal(movies.length, 1);
      const [movie] = movies;
      assert.ok(movie);
      assert.equal(movie.title, "Inception");
    });

    it("searches directors as well as titles", async () => {
      const movies = (await api.get("/movies?search=nolan")).body as Movie[];

      assert.ok(movies.length >= 2);
      assert.ok(movies.every((movie) => movie.director.includes("Nolan")));
    });

    it("combines genre and search filters", async () => {
      const movies = (await api.get("/movies?genre=Action&search=nolan")).body as Movie[];

      assert.ok(movies.length > 0);
      assert.ok(movies.every((movie) => movie.genres.includes("Action")));
      assert.ok(movies.every((movie) => movie.director.includes("Nolan")));
    });

    it("treats SQL text in the search term as literal input", async () => {
      const response = await api.get(
        `/movies?search=${encodeURIComponent("'; drop table \"Movie\"; --")}`,
      );

      assert.equal(response.status, 200);
      assert.deepEqual(response.body, []);
      // The table still exists and is intact.
      assert.equal(((await api.get("/movies")).body as Movie[]).length, 20);
    });
  });

  describe("GET /movies/:id", () => {
    it("returns a single movie", async () => {
      const response = await api.get("/movies/1");

      assert.equal(response.status, 200);
      assert.equal((response.body as Movie).title, "Inception");
    });

    it("returns 404 for an id outside the catalogue", async () => {
      assert.equal((await api.get("/movies/99999")).status, 404);
    });

    it("returns 400 for a non-numeric id", async () => {
      assert.equal((await api.get("/movies/abc")).status, 400);
    });

    it("returns 400 for a non-integer id", async () => {
      assert.equal((await api.get("/movies/1.5")).status, 400);
    });

    it("returns 400 for id 0", async () => {
      assert.equal((await api.get("/movies/0")).status, 400);
    });
  });

  describe("POST /movies/recommend (validation only)", () => {
    it("returns 400 when the prompt is missing", async () => {
      assert.equal((await api.post("/movies/recommend", {})).status, 400);
    });

    it("returns 400 when the prompt is too short", async () => {
      const response = await api.post("/movies/recommend", { prompt: "x" });

      assert.equal(response.status, 400);
      assert.equal((response.body as { message: string }).message, "Validation failed");
    });

    it("returns 400 when the prompt is too long", async () => {
      assert.equal(
        (await api.post("/movies/recommend", { prompt: "x".repeat(1001) })).status,
        400,
      );
    });
  });
});
