/**
 * Authentication and authorization tests.
 *
 * The 401/403 split is deliberate:
 *   401 - we cannot tell who you are (missing/expired/invalid token, bad login)
 *   403 - we know who you are, but you do not own this resource
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { env } from "../../src/config/env.js";
import { prisma } from "../../src/config/prisma.js";
import { createClient, createUser, deleteUser, startServer, uniqueEmail } from "../helpers/api.js";
import type { ApiClient, TestServer, TestUser } from "../helpers/api.js";

type PublicUser = { id: string; email: string; username: string; createdAt: string };

describe("auth", () => {
  let server: TestServer;
  let api: ApiClient;
  const created: TestUser[] = [];

  const user = async (overrides?: Parameters<typeof createUser>[1]) => {
    const entry = await createUser(api, overrides);
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

  describe("POST /auth/register", () => {
    it("returns 201 with the public user and no token or password", async () => {
      const email = uniqueEmail("register");
      const response = await api.post("/auth/register", {
        email,
        password: "secret123",
        username: "NewUser",
      });

      assert.equal(response.status, 201);

      const body = response.body as Record<string, unknown>;
      assert.equal(body["email"], email.toLowerCase());
      assert.equal(body["username"], "NewUser");
      assert.equal(typeof body["id"], "string");
      assert.equal("password" in body, false, "password hash must never be returned");
      assert.equal("token" in body, false, "registration must not issue a token");

      await prisma.user.deleteMany({ where: { email: email.toLowerCase() } });
    });

    it("returns 409 when the email already exists", async () => {
      const existing = await user();

      const response = await api.post("/auth/register", {
        email: existing.email,
        password: "another123",
        username: "Duplicate",
      });

      assert.equal(response.status, 409);
      assert.match((response.body as { message: string }).message, /exists/i);
    });

    it("returns 400 with per-field errors when fields are missing", async () => {
      const response = await api.post("/auth/register", { password: "secret123" });

      assert.equal(response.status, 400);
      const body = response.body as { message: string; errors: string[] };
      // `message` repeats the first concrete problem so the UI can show it.
      assert.match(body.message, /^Email |^Username /);
      assert.ok(body.errors.some((error) => error.startsWith("email:")));
      assert.ok(body.errors.some((error) => error.startsWith("username:")));
    });

    it("names the password minimum length when the password is too short", async () => {
      const response = await api.post("/auth/register", {
        email: uniqueEmail("pwshort"),
        password: "123",
        username: "Short",
      });

      assert.equal(response.status, 400);
      const body = response.body as { message: string; errors: string[] };

      // Human-readable at the top level (this is what the frontend displays)...
      assert.match(body.message, /password/i);
      assert.match(body.message, /too short/i);
      assert.match(body.message, /6/);

      // ...and machine-readable in `errors`.
      assert.ok(body.errors.some((error) => error.startsWith("password:")));
    });

    it("rejects a malformed email with 400", async () => {
      const response = await api.post("/auth/register", {
        email: "not-an-email",
        password: "secret123",
        username: "Nope",
      });

      assert.equal(response.status, 400);
    });

    it("rejects a password shorter than 6 characters with 400", async () => {
      const response = await api.post("/auth/register", {
        email: uniqueEmail("short"),
        password: "12345",
        username: "Short",
      });

      assert.equal(response.status, 400);
    });

    it("rejects a username longer than 50 characters with 400", async () => {
      const response = await api.post("/auth/register", {
        email: uniqueEmail("long"),
        password: "secret123",
        username: "x".repeat(51),
      });

      assert.equal(response.status, 400);
    });
  });

  describe("POST /auth/login", () => {
    it("returns 200 with a token and the public user", async () => {
      const existing = await user();

      const response = await api.post("/auth/login", {
        email: existing.email,
        password: existing.password,
      });

      assert.equal(response.status, 200);
      const body = response.body as { token: string; user: PublicUser };
      assert.equal(typeof body.token, "string");
      assert.equal(body.user.id, existing.id);
      assert.equal("password" in body.user, false);
    });

    it("returns the same 401 for a wrong password and an unknown email", async () => {
      const existing = await user();

      const wrongPassword = await api.post("/auth/login", {
        email: existing.email,
        password: "definitely-wrong",
      });
      const unknownEmail = await api.post("/auth/login", {
        email: "ghost@test.local",
        password: "secret123",
      });

      assert.equal(wrongPassword.status, 401);
      assert.equal(unknownEmail.status, 401);
      // Identical messages prevent account enumeration.
      assert.equal(
        (wrongPassword.body as { message: string }).message,
        (unknownEmail.body as { message: string }).message,
      );
    });

    it("returns 400 when credentials are missing", async () => {
      assert.equal((await api.post("/auth/login", {})).status, 400);
    });
  });

  describe("GET /auth/me", () => {
    it("returns 200 for the token's own user", async () => {
      const existing = await user();

      const response = await api.get("/auth/me", { token: existing.token });

      assert.equal(response.status, 200);
      assert.equal((response.body as PublicUser).id, existing.id);
    });

    it("returns 401 without a token", async () => {
      assert.equal((await api.get("/auth/me")).status, 401);
    });
  });

  describe("token verification", () => {
    it("returns 401 without an Authorization header", async () => {
      assert.equal((await api.get("/watchlist")).status, 401);
    });

    it("returns 401 for a non-Bearer scheme", async () => {
      const response = await api.get("/watchlist", {
        headers: { Authorization: "Basic abc" },
      });
      assert.equal(response.status, 401);
    });

    it("returns 401 for an empty bearer token", async () => {
      const response = await api.get("/watchlist", {
        headers: { Authorization: "Bearer   " },
      });
      assert.equal(response.status, 401);
    });

    it("returns 401 for a garbage token", async () => {
      assert.equal((await api.get("/watchlist", { token: "not.a.jwt" })).status, 401);
    });

    it("returns 401 for a token signed with the wrong secret", async () => {
      const forged = jwt.sign({ sub: "someone" }, "wrong-secret", { expiresIn: "1h" });
      assert.equal((await api.get("/watchlist", { token: forged })).status, 401);
    });

    it("returns 401 with an explicit message for an expired token", async () => {
      const existing = await user();
      const expired = jwt.sign({ sub: existing.id }, env.JWT_SECRET, { expiresIn: -10 });

      const response = await api.get("/watchlist", { token: expired });

      assert.equal(response.status, 401);
      assert.equal((response.body as { message: string }).message, "Token has expired");
    });

    it("returns 401 for a valid token whose account was deleted", async () => {
      const existing = await user();
      await prisma.user.delete({ where: { id: existing.id } });

      const response = await api.get("/watchlist", { token: existing.token });

      assert.equal(response.status, 401);
      assert.equal((response.body as { message: string }).message, "Account no longer exists");
    });
  });
});
