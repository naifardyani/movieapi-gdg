/**
 * Watched / review tests.
 *
 * Covers the 403 ownership path: deleting a review that belongs to another
 * user is forbidden (403), not merely "not found" (404).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient, createUser, deleteUser, startServer } from "../helpers/api.js";
import type { ApiClient, TestServer, TestUser } from "../helpers/api.js";

type Review = {
  id: string;
  userId: string;
  movieId: number;
  rating: number;
  review: string;
  movie: { id: number; title: string };
};

const MISSING_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("watched", () => {
  let server: TestServer;
  let api: ApiClient;
  const created: TestUser[] = [];

  const user = async () => {
    const entry = await createUser(api);
    created.push(entry);
    return entry;
  };

  before(async () => {
    server = await startServer();
    api = createClient(server.baseUrl);
  });

  after(async () => {
    await Promise.all(created.map((entry) => deleteUser(entry.id)));
    await server.close();
  });

  it("requires authentication", async () => {
    assert.equal((await api.get("/watched")).status, 401);
  });

  describe("POST /watched", () => {
    it("records a review with the nested movie shape", async () => {
      const owner = await user();

      const response = await api.post(
        "/watched",
        { movieId: 1, rating: 5, review: "A masterpiece." },
        { token: owner.token },
      );

      assert.equal(response.status, 201);
      const item = response.body as Review;

      assert.equal(item.userId, owner.id);
      assert.equal(item.movieId, 1);
      assert.equal(item.rating, 5);
      assert.equal(item.review, "A masterpiece.");
      assert.equal(item.movie.title, "Inception");
    });

    it("accepts the frontend's movie_id and opinion aliases", async () => {
      const owner = await user();

      const response = await api.post(
        "/watched",
        { movie_id: 2, rating: 4, opinion: "Excellent." },
        { token: owner.token },
      );

      assert.equal(response.status, 201);
      const item = response.body as Review;
      assert.equal(item.movieId, 2);
      assert.equal(item.review, "Excellent.");
    });

    it("updates an existing review instead of creating a duplicate", async () => {
      const owner = await user();

      const first = await api.post(
        "/watched",
        { movieId: 3, rating: 3, review: "Good." },
        { token: owner.token },
      );
      const second = await api.post(
        "/watched",
        { movieId: 3, rating: 5, review: "Better on rewatch." },
        { token: owner.token },
      );

      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.equal((first.body as Review).id, (second.body as Review).id);
      assert.equal((second.body as Review).rating, 5);

      assert.equal(((await api.get("/watched", { token: owner.token })).body as Review[]).length, 1);
    });

    it("returns 400 when rating is out of range", async () => {
      const owner = await user();

      for (const rating of [0, 6, -1]) {
        const response = await api.post(
          "/watched",
          { movieId: 1, rating, review: "Invalid rating." },
          { token: owner.token },
        );
        assert.equal(response.status, 400, `rating ${rating} should be rejected`);
      }
    });

    it("returns 400 when the review text is empty", async () => {
      const owner = await user();

      const response = await api.post(
        "/watched",
        { movieId: 1, rating: 4, review: "   " },
        { token: owner.token },
      );

      assert.equal(response.status, 400);
    });

    it("returns 404 when the movie does not exist", async () => {
      const owner = await user();

      const response = await api.post(
        "/watched",
        { movieId: 99999, rating: 4, review: "Ghost movie." },
        { token: owner.token },
      );

      assert.equal(response.status, 404);
    });

    it("returns 400 when movieId is not an integer", async () => {
      const owner = await user();

      const response = await api.post(
        "/watched",
        { movieId: "abc", rating: 4, review: "Text." },
        { token: owner.token },
      );

      assert.equal(response.status, 400);
    });
  });

  describe("DELETE /watched/:id", () => {
    it("returns 204 when the owner deletes their review", async () => {
      const owner = await user();
      const record = await api.post(
        "/watched",
        { movieId: 5, rating: 4, review: "Mine." },
        { token: owner.token },
      );
      const reviewId = (record.body as Review).id;

      const response = await api.delete(`/watched/${reviewId}`, { token: owner.token });

      assert.equal(response.status, 204);
      assert.equal(response.text, "");
      assert.equal(((await api.get("/watched", { token: owner.token })).body as Review[]).length, 0);
    });

    it("returns 403 when deleting another user's review", async () => {
      const owner = await user();
      const intruder = await user();

      const record = await api.post(
        "/watched",
        { movieId: 6, rating: 5, review: "Owner's." },
        { token: owner.token },
      );
      const reviewId = (record.body as Review).id;

      const response = await api.delete(`/watched/${reviewId}`, { token: intruder.token });

      assert.equal(response.status, 403);
      // The review is untouched.
      assert.equal(((await api.get("/watched", { token: owner.token })).body as Review[]).length, 1);
    });

    it("returns 404 for a review id that does not exist", async () => {
      const owner = await user();

      assert.equal(
        (await api.delete(`/watched/${MISSING_UUID}`, { token: owner.token })).status,
        404,
      );
    });

    it("returns 400 for a malformed review id", async () => {
      const owner = await user();

      assert.equal((await api.delete("/watched/not-a-uuid", { token: owner.token })).status, 400);
    });

    it("requires authentication", async () => {
      assert.equal((await api.delete(`/watched/${MISSING_UUID}`)).status, 401);
    });
  });
});
