/**
 * Unit tests for the dependency-free validators.
 *
 * These are pure functions, so nothing here touches the database or network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEmail,
  isInt,
  isPassword,
  isString,
  isText,
  isUuid,
  optional,
} from "../../src/middlewares/validate.middleware.js";

function okValue<T>(result: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  assert.equal(result.ok, true, "expected validation to succeed");
  return (result as { ok: true; value: T }).value;
}

function errorList(result: { ok: true; value: unknown } | { ok: false; errors: string[] }): string[] {
  assert.equal(result.ok, false, "expected validation to fail");
  return (result as { ok: false; errors: string[] }).errors;
}

describe("isString", () => {
  it("trims surrounding whitespace", () => {
    assert.equal(okValue(isString()("  Inception  ")), "Inception");
  });

  it("rejects non-strings", () => {
    assert.deepEqual(errorList(isString()(42)), ["must be a string"]);
    assert.deepEqual(errorList(isString()({})), ["must be a string"]);
  });

  it("says a field is required when it is absent", () => {
    assert.deepEqual(errorList(isString()(undefined)), ["is required"]);
    assert.deepEqual(errorList(isString()(null)), ["is required"]);
  });

  it("enforces the length bounds", () => {
    assert.equal(errorList(isString(1, 5)("      ")).length, 1);
    assert.equal(errorList(isString(3, 5)("ab")).length, 1);
    assert.equal(errorList(isString(3, 5)("abcdef")).length, 1);
    assert.equal(okValue(isString(3, 5)("abcd")), "abcd");
  });

  it("explains whether the value is too short or too long", () => {
    assert.match(errorList(isString(3, 5)("ab"))[0] ?? "", /too short/i);
    assert.match(errorList(isString(3, 5)("abcdef"))[0] ?? "", /too long/i);
    assert.equal(errorList(isString(1, 5)("   "))[0], "must not be empty");
  });
});

describe("isText", () => {
  it("accepts multi-line review text", () => {
    assert.equal(okValue(isText(1, 100)("line one\nline two")), "line one\nline two");
  });

  it("rejects text beyond the maximum", () => {
    assert.equal(errorList(isText(1, 10)("x".repeat(11))).length, 1);
  });
});

describe("isEmail", () => {
  it("trims and lowercases valid addresses", () => {
    assert.equal(okValue(isEmail("  User@Example.COM ")), "user@example.com");
  });

  it("rejects malformed addresses", () => {
    for (const candidate of ["nope", "a@b", "a b@c.com", "@example.com", "a@@b.com"]) {
      assert.equal(errorList(isEmail(candidate)).length, 1, `should reject ${candidate}`);
    }
  });

  it("rejects addresses longer than 254 characters", () => {
    assert.equal(errorList(isEmail(`${"a".repeat(250)}@b.co`)).length, 1);
  });

  it("rejects non-strings", () => {
    assert.deepEqual(errorList(isEmail(123)), ["must be a string"]);
  });
});

describe("isPassword", () => {
  it("accepts 6 to 128 characters", () => {
    assert.equal(okValue(isPassword("123456")), "123456");
    assert.equal(okValue(isPassword("x".repeat(128))).length, 128);
  });

  it("rejects out-of-range lengths", () => {
    assert.equal(errorList(isPassword("12345")).length, 1);
    assert.equal(errorList(isPassword("x".repeat(129))).length, 1);
  });

  it("says the password is too short (or too long) in plain words", () => {
    assert.match(errorList(isPassword("12345"))[0] ?? "", /too short/i);
    assert.match(errorList(isPassword("12345"))[0] ?? "", /6/);
    assert.match(errorList(isPassword("x".repeat(129)))[0] ?? "", /too long/i);
    assert.match(errorList(isPassword("x".repeat(129)))[0] ?? "", /128/);
  });

  it("does not trim passwords", () => {
    assert.equal(okValue(isPassword("  secret  ")), "  secret  ");
  });
});

describe("isInt", () => {
  it("accepts numbers and numeric strings", () => {
    assert.equal(okValue(isInt(1)(5)), 5);
    assert.equal(okValue(isInt(1)("5")), 5);
  });

  it("rejects floats, NaN, Infinity and empty strings", () => {
    for (const candidate of [1.5, "1.5", Number.NaN, "abc", "  ", Infinity]) {
      assert.equal(errorList(isInt(1)(candidate)).length, 1, `should reject ${String(candidate)}`);
    }
  });

  it("enforces the range", () => {
    assert.equal(errorList(isInt(1)(0)).length, 1);
    assert.equal(errorList(isInt(1)(-3)).length, 1);
    assert.equal(errorList(isInt(1, 5)(6)).length, 1);
    assert.equal(okValue(isInt(1, 5)(5)), 5);
  });

  it("rejects booleans even though Number(true) is 1", () => {
    assert.equal(errorList(isInt(1)(true)).length, 1);
  });

  it("says a value is required when it is absent", () => {
    assert.deepEqual(errorList(isInt(1)(undefined)), ["is required"]);
    assert.deepEqual(errorList(isInt(1)(null)), ["is required"]);
  });
});

describe("optional", () => {
  const validator = optional(isString(3, 10));

  it("treats undefined, null and '' as absent", () => {
    assert.equal(okValue(validator(undefined)), undefined);
    assert.equal(okValue(validator(null)), undefined);
    assert.equal(okValue(validator("")), undefined);
  });

  it("delegates when a value is present", () => {
    assert.equal(okValue(validator("hello")), "hello");
    assert.equal(errorList(validator("no")).length, 1);
  });
});

describe("isUuid", () => {
  it("accepts canonical uuids in either case", () => {
    const lower = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    assert.equal(okValue(isUuid(lower)), lower);
    assert.equal(okValue(isUuid(lower.toUpperCase())), lower.toUpperCase());
  });

  it("rejects junk that would otherwise reach the database", () => {
    for (const candidate of ["abc", "1", "3f2504e0-4f89-41d3-9a0c", "not-a-uuid", ""]) {
      assert.equal(errorList(isUuid(candidate)).length, 1, `should reject ${candidate}`);
    }
  });

  it("rejects non-strings", () => {
    assert.deepEqual(errorList(isUuid(42)), ["must be a string"]);
  });
});
