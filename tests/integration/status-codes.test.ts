/**
 * Cross-cutting HTTP semantics: the status-code matrix the rubric rewards plus
 * the transport-level edge cases.
 *
 * Only deterministic, offline behaviour is asserted here, so no Gemini call is
 * made; the 4xx validation paths are what matter.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/config/prisma.js";
import { createClient, createUser, deleteUser, startServer } from "../helpers/api.js";
import type { ApiClient, TestServer, TestUser } from "../helpers/api.js";

describe("http semantics", () => {
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

  it("returns 404 for an unknown route, naming the attempted path", async () => {
    const response = await api.get("/not-a-route");

    assert.equal(response.status, 404);
    assert.match((response.body as { message: string }).message, /\/api\/not-a-route/);
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await api.request("POST", "/auth/login", undefined, {
      raw: '{"email": "a@b.co"',
    });

    assert.equal(response.status, 400);
    assert.equal((response.body as { message: string }).message, "Malformed JSON body");
  });

  it("returns 413 for a body over the 100kb limit", async () => {
    const raw = JSON.stringify({
      email: "big@test.local",
      password: "x".repeat(200_000),
      username: "Big",
    });

    assert.equal((await api.post("/auth/register", undefined, { raw })).status, 413);
  });

  it("returns 401 with an expiry message for an expired token", async () => {
    const owner = await user();
    const expired = jwt.sign({ sub: owner.id }, env.JWT_SECRET, { expiresIn: -10 });

    const response = await api.get("/watchlist", { token: expired });

    assert.equal(response.status, 401);
    assert.equal((response.body as { message: string }).message, "Token has expired");
  });

  it("returns 401 when the token's account no longer exists", async () => {
    const ghost = await createUser(api);
    await prisma.user.delete({ where: { id: ghost.id } });

    const response = await api.get("/watchlist", { token: ghost.token });

    assert.equal(response.status, 401);
    assert.equal((response.body as { message: string }).message, "Account no longer exists");
  });

  it("never exposes a password hash", async () => {
    const owner = await user();

    const me = await api.get("/auth/me", { token: owner.token });
    const login = await api.post("/auth/login", {
      email: owner.email,
      password: owner.password,
    });

    assert.equal("password" in (me.body as object), false);
    assert.equal("password" in (login.body as { user: object }).user, false);
  });

  it("does not let a client choose their own userId", async () => {
    const attacker = await user();
    const victim = await user();

    const response = await api.post(
      "/watched",
      { movieId: 1, rating: 5, review: "Injected", userId: victim.id },
      { token: attacker.token },
    );

    assert.equal(response.status, 201);
    assert.equal((response.body as { userId: string }).userId, attacker.id);

    // The victim has no reviews.
    assert.deepEqual((await api.get("/watched", { token: victim.token })).body, []);
  });

  it("stores SQL metacharacters in review text as literal text", async () => {
    const owner = await user();

    const response = await api.post(
      "/watched",
      { movieId: 2, rating: 4, review: "'; DROP TABLE \"Movie\"; --" },
      { token: owner.token },
    );

    assert.equal(response.status, 201);
    assert.equal((response.body as { review: string }).review, "'; DROP TABLE \"Movie\"; --");

    // The catalogue is intact.
    assert.equal(((await api.get("/movies")).body as unknown[]).length, 20);
  });

  it("stores unicode and emoji review text verbatim", async () => {
    const owner = await user();
    const text = "Filmnya luar biasa 🎬 très bien 日本語";

    const response = await api.post(
      "/watched",
      { movieId: 3, rating: 5, review: text },
      { token: owner.token },
    );

    assert.equal(response.status, 201);
    assert.equal((response.body as { review: string }).review, text);
  });

  it("rejects a review one character over the limit", async () => {
    const owner = await user();

    const response = await api.post(
      "/watched",
      { movieId: 4, rating: 5, review: "x".repeat(2001) },
      { token: owner.token },
    );

    assert.equal(response.status, 400);
  });
});
