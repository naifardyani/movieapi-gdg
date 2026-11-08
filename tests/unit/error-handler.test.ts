/**
 * Unit tests for the error -> HTTP status mapping.
 *
 * The handler is called directly with fake req/res objects, which lets us cover
 * Prisma failure codes that the services normally prevent (invalid foreign key,
 * unique violation, ...) without corrupting the test database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { errorHandler } from "../../src/middlewares/error.middleware.js";
import { HttpError } from "../../src/utils/HttpError.js";

type Captured = { status?: number; json?: unknown };

function invoke(error: unknown): Captured {
  const captured: Captured = {};

  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.json = payload;
      return this;
    },
  } as unknown as Response;

  errorHandler(error, {} as Request, res, (() => {}) as NextFunction);

  return captured;
}

function knownError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("simulated", {
    code,
    clientVersion: "7.10.1",
    meta,
  });
}

describe("HttpError", () => {
  it("keeps the status carried by the error", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      const captured = invoke(new HttpError(status, `error ${status}`));
      assert.equal(captured.status, status);
      assert.deepEqual(captured.json, { message: `error ${status}` });
    }
  });

  it("adds `errors` only when details are present", () => {
    assert.deepEqual(invoke(new HttpError(400, "Validation failed", ["email: bad"])).json, {
      message: "Validation failed",
      errors: ["email: bad"],
    });
    assert.deepEqual(invoke(new HttpError(404, "Not found")).json, { message: "Not found" });
  });
});

describe("transport errors", () => {
  it("maps malformed JSON to 400", () => {
    const error = Object.assign(new SyntaxError("Unexpected token"), {
      type: "entity.parse.failed",
      body: "{oops",
    });

    const captured = invoke(error);
    assert.equal(captured.status, 400);
    assert.deepEqual(captured.json, { message: "Malformed JSON body" });
  });

  it("maps oversized payloads to 413", () => {
    const error = Object.assign(new Error("too large"), { type: "entity.too.large" });
    assert.equal(invoke(error).status, 413);
  });

  it("maps URI decode failures to 400", () => {
    const captured = invoke(new URIError("Failed to decode param"));
    assert.equal(captured.status, 400);
    assert.deepEqual(captured.json, { message: "Malformed URL parameter" });
  });
});

describe("Prisma known errors", () => {
  it("maps P2002 unique violations to 409 and names the conflicting field", () => {
    const captured = invoke(knownError("P2002", { target: ["email"] }));
    assert.equal(captured.status, 409);
    assert.match((captured.json as { message: string }).message, /email/);
  });

  it("maps P2003 invalid foreign keys to 400", () => {
    assert.equal(invoke(knownError("P2003")).status, 400);
  });

  it("maps P2025 missing records to 404", () => {
    assert.equal(invoke(knownError("P2025")).status, 404);
  });

  it("maps P2000 value-too-long to 400", () => {
    assert.equal(invoke(knownError("P2000")).status, 400);
  });

  it("falls back to 500 for codes without a mapping", () => {
    assert.equal(invoke(knownError("P9999")).status, 500);
  });
});

describe("Prisma other errors", () => {
  it("maps query validation errors to 500 (our bug, not the client's)", () => {
    const error = new Prisma.PrismaClientValidationError("bad query", { clientVersion: "7.10.1" });
    assert.equal(invoke(error).status, 500);
  });

  it("maps connection failures to 503", () => {
    const error = new Prisma.PrismaClientInitializationError("cannot connect", "7.10.1");
    assert.equal(invoke(error).status, 503);
  });
});

describe("unknown errors", () => {
  it("never exposes internals in the message", () => {
    const captured = invoke(new Error("secret internal detail"));
    assert.equal(captured.status, 500);
    assert.equal((captured.json as { message: string }).message, "Internal server error");
  });
});
