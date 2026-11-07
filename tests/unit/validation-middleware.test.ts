/**
 * Unit tests for the validation middleware as middleware.
 *
 * These check the behaviour that a pure validator test cannot see: alias
 * resolution, normalization, and the fact that unlisted keys are stripped from
 * the request before any handler runs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  isInt,
  isString,
  optional,
  validateBody,
  validateQuery,
} from "../../src/middlewares/validate.middleware.js";

type Outcome =
  | { kind: "next" }
  | { kind: "response"; status: number; body: unknown };

function run(
  middleware: ReturnType<typeof validateBody>,
  source: Record<string, unknown>,
): { outcome: Outcome; request: Request } {
  const request = {
    body: structuredClone(source),
    query: structuredClone(source),
    params: {},
  } as unknown as Request;

  let outcome: Outcome = { kind: "next" };

  const response = {
    status(code: number) {
      return {
        json(payload: unknown) {
          outcome = { kind: "response", status: code, body: payload };
        },
      };
    },
  } as unknown as Response;

  middleware(request, response, (() => undefined) as NextFunction);

  return { outcome, request };
}

describe("validateBody", () => {
  it("passes normalized values to the handler", () => {
    const { outcome, request } = run(validateBody({ title: isString(1, 50) }), {
      title: "  Inception  ",
    });

    assert.deepEqual(outcome, { kind: "next" });
    assert.deepEqual(request.body, { title: "Inception" });
  });

  it("drops keys that are not in the schema (no userId injection)", () => {
    const { request } = run(validateBody({ movieId: isInt(1) }), {
      movieId: 1,
      userId: "attacker-supplied",
      createdAt: "1999-01-01",
    });

    assert.deepEqual(request.body, { movieId: 1 });
  });

  it("resolves alias keys onto the canonical key", () => {
    const { outcome, request } = run(validateBody({ movieId: isInt(1) }, { movieId: ["movie_id"] }), {
      movie_id: "14",
    });

    assert.deepEqual(outcome, { kind: "next" });
    assert.deepEqual(request.body, { movieId: 14 });
  });

  it("prefers the canonical key over the alias", () => {
    const { request } = run(validateBody({ movieId: isInt(1) }, { movieId: ["movie_id"] }), {
      movieId: 3,
      movie_id: 9,
    });

    assert.deepEqual(request.body, { movieId: 3 });
  });

  it("falls back to the alias when the canonical key is empty", () => {
    const { request } = run(validateBody({ movieId: isInt(1) }, { movieId: ["movie_id"] }), {
      movieId: "",
      movie_id: 7,
    });

    assert.deepEqual(request.body, { movieId: 7 });
  });

  it("reports every failure at once with 400", () => {
    const { outcome } = run(
      validateBody({ email: isString(1, 20), password: isString(6, 128) }),
      { email: "", password: "abc" },
    );

    assert.equal(outcome.kind, "response");
    if (outcome.kind !== "response") return;

    assert.equal(outcome.status, 400);
    const body = outcome.body as { message: string; errors: string[] };
    // Top-level message is the first concrete problem, not a generic string.
    assert.match(body.message, /^Email /);
    assert.equal(body.errors.length, 2);
    assert.ok(body.errors.some((error) => error.startsWith("email:")));
    assert.ok(body.errors.some((error) => error.startsWith("password:")));
  });

  it("omits optional keys that were not sent", () => {
    const { outcome, request } = run(validateBody({ genre: optional(isString(1, 50)) }), {});

    assert.deepEqual(outcome, { kind: "next" });
    assert.deepEqual(request.body, {});
  });
});

describe("validateQuery", () => {
  it("clears previous keys so unvalidated query params cannot leak through", () => {
    const request = {
      body: {},
      query: { genre: "Sci-Fi", sneaky: "1" },
      params: {},
    } as unknown as Request;

    let outcome: Outcome = { kind: "next" };
    const response = {
      status(code: number) {
        return {
          json(payload: unknown) {
            outcome = { kind: "response", status: code, body: payload };
          },
        };
      },
    } as unknown as Response;

    validateQuery({ genre: optional(isString(1, 50)) })(
      request,
      response,
      (() => undefined) as NextFunction,
    );

    assert.deepEqual(outcome, { kind: "next" });
    assert.deepEqual(request.query, { genre: "Sci-Fi" });
  });
});
