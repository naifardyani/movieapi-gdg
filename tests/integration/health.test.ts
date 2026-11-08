/**
 * Service-shell smoke tests: the metadata root and the health probe that a
 * deploy platform will hit.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClient, startServer } from "../helpers/api.js";
import type { ApiClient, TestServer } from "../helpers/api.js";

describe("service shell", () => {
  let server: TestServer;
  let api: ApiClient;

  before(async () => {
    server = await startServer();
    api = createClient(server.baseUrl);
  });

  after(async () => {
    await server.close();
  });

  it("GET / describes the service", async () => {
    const response = await fetch(`${server.baseUrl.replace(/\/api$/, "")}/`);
    const body = (await response.json()) as { name: string; version: string; docs: string };

    assert.equal(response.status, 200);
    assert.equal(body.name, "FilmLog API");
    assert.equal(typeof body.version, "string");
    assert.equal(body.docs, "/api/health");
  });

  it("GET /api/health reports uptime", async () => {
    const response = await api.get("/health");
    const body = response.body as { status: string; uptime: number };

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(typeof body.uptime, "number");
    assert.ok(body.uptime >= 0);
  });
});
