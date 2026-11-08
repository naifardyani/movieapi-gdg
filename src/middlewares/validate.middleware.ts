/**
 * Dependency-free request validation middleware.
 *
 * Every validator takes untrusted input and returns either a normalized value or a list of errors. This replaces
 * req.body / req.query / req.params with only the validated keys. Unknown keys are silently dropped, so the controller can trust what the validator allows.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ValidationResult, Validator, ValidatorShape } from "../types/validators.js";

const MAX_STRING_LENGTH = 10_000;

/* -------------------------------------------------------------------------- */
/*                              Primitive validators                          */
/* -------------------------------------------------------------------------- */

/** Distinguishes an absent field from one sent with the wrong type. */
function missing(input: unknown): boolean {
  return input === undefined || input === null;
}

export const isString =
  (min = 1, max = 500): Validator<string> =>
  (input) => {
    if (missing(input)) {
      return { ok: false, errors: ["is required"] };
    }
    if (typeof input !== "string") {
      return { ok: false, errors: ["must be a string"] };
    }
    const value = input.trim();
    if (value.length < min) {
      return {
        ok: false,
        errors: [min === 1 ? "must not be empty" : `is too short (at least ${min} characters)`],
      };
    }
    if (value.length > max) {
      return { ok: false, errors: [`is too long (at most ${max} characters)`] };
    }
    return { ok: true, value };
  };

/** Free-form text (reviews, prompts): trimmed, length-bounded. */
export const isText = (min = 1, max = MAX_STRING_LENGTH): Validator<string> => isString(min, max);

export const isEmail: Validator<string> = (input) => {
  if (missing(input)) {
    return { ok: false, errors: ["is required"] };
  }
  if (typeof input !== "string") {
    return { ok: false, errors: ["must be a string"] };
  }
  const value = input.trim().toLowerCase();
  // Intentionally pragmatic: one @, no whitespace, a dot in the domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
    return { ok: false, errors: ["must be a valid email address"] };
  }
  return { ok: true, value };
};

const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

export const isPassword: Validator<string> = (input) => {
  if (missing(input)) {
    return { ok: false, errors: ["is required"] };
  }
  if (typeof input !== "string") {
    return { ok: false, errors: ["must be a string"] };
  }
  if (input.length < PASSWORD_MIN) {
    // Spelled out so the client can show a useful warning instead of a generic
    // "validation failed" message.
    return {
      ok: false,
      errors: [`is too short (at least ${PASSWORD_MIN} characters)`],
    };
  }
  if (input.length > PASSWORD_MAX) {
    return {
      ok: false,
      errors: [`is too long (at most ${PASSWORD_MAX} characters)`],
    };
  }
  return { ok: true, value: input };
};

/**
 * Accepts numbers and numeric strings (query/params arrive as strings).
 * Rejects floats, NaN, Infinity and empty strings.
 */
export const isInt =
  (min: number, max = Number.MAX_SAFE_INTEGER): Validator<number> =>
  (input) => {
    if (missing(input)) {
      return { ok: false, errors: ["is required"] };
    }

    const parsed =
      typeof input === "number"
        ? input
        : typeof input === "string" && input.trim() !== ""
          ? Number(input)
          : Number.NaN;

    if (!Number.isInteger(parsed)) {
      return { ok: false, errors: ["must be a whole number"] };
    }
    if (parsed < min || parsed > max) {
      return {
        ok: false,
        errors: [
          min === 1 && max === Number.MAX_SAFE_INTEGER
            ? "must be a positive whole number"
            : `must be between ${min} and ${max}`,
        ],
      };
    }
    return { ok: true, value: parsed };
  };

/** Treats undefined / null / "" as absent and yields undefined. */
export const optional =
  <T>(validator: Validator<T>): Validator<T | undefined> =>
  (input) => {
    if (input === undefined || input === null || input === "") {
      return { ok: true, value: undefined };
    }
    return validator(input);
  };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Prisma `@default(uuid())` ids. Rejects junk before it reaches the database. */
export const isUuid: Validator<string> = (input) => {
  if (missing(input)) {
    return { ok: false, errors: ["is required"] };
  }
  if (typeof input !== "string") {
    return { ok: false, errors: ["must be a string"] };
  }
  const value = input.trim();
  if (!UUID_PATTERN.test(value)) {
    return { ok: false, errors: ["must be a valid UUID"] };
  }
  return { ok: true, value };
};

/* -------------------------------------------------------------------------- */
/*                                  Middleware                                */
/* -------------------------------------------------------------------------- */

type Target = "body" | "query" | "params";

/** canonical key -> accepted alternative keys (frontend sends both spellings). */
export type AliasMap = Record<string, string[]>;

function readWithAliases(
  record: Record<string, unknown>,
  key: string,
  aliases: AliasMap,
): unknown {
  const direct = record[key];
  if (direct !== undefined && direct !== null && direct !== "") {
    return direct;
  }

  for (const alias of aliases[key] ?? []) {
    const candidate = record[alias];
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      return candidate;
    }
  }

  return undefined;
}

function runShape<T extends Record<string, unknown>>(
  shape: ValidatorShape<T>,
  source: unknown,
  aliases: AliasMap,
): ValidationResult<Partial<T>> {
  const errors: string[] = [];
  const normalized: Record<string, unknown> = {};
  const record = typeof source === "object" && source !== null ? (source as Record<string, unknown>) : {};

  for (const [key, validator] of Object.entries(shape) as [string, Validator<unknown>][]) {
    const result = validator(readWithAliases(record, key, aliases));
    if (result.ok) {
      if (result.value !== undefined) {
        normalized[key] = result.value;
      }
    } else {
      errors.push(`${key}: ${result.errors.join(", ")}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: normalized as Partial<T> };
}

/** "password: is too short (...)" -> "Password is too short (...)" */
function humanize(error: string): string {
  const separator = error.indexOf(": ");
  if (separator === -1) {
    return error;
  }

  const field = error.slice(0, separator).trim();
  const detail = error.slice(separator + 2).trim();

  // camelCase -> spaced words, then title-case: movieId -> Movie ID.
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const capitalized = spaced.charAt(0).toUpperCase() + spaced.slice(1);

  return `${capitalized.replace(/\bId\b/g, "ID")} ${detail}`;
}

/**
 * A message the UI can display as-is.
 *
 * `errors` stays machine-readable ("password: is too short"); this turns the
 * same information into a sentence so a client that only reads `message` (like
 * frontend/app.js) still tells the user exactly what is wrong.
 */
function describeErrors(errors: string[]): string {
  const messages = errors.map(humanize);
  // No generic "Validation failed" prefix: every line names a real problem.
  return messages.length === 0 ? "Validation failed" : messages.join("; ");
}

function validate(
  target: Target,
  shape: ValidatorShape<Record<string, unknown>>,
  aliases: AliasMap,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = runShape(shape, req[target], aliases);

    if (!result.ok) {
      // 400: the client sent a payload that fails validation. (422 is reserved
      // for well-formed requests that the server cannot process semantically,
      // e.g. the AI naming a movie outside the catalogue.)
      //
      // `message` repeats the concrete problems, not just "Validation failed":
      // the frontend companion only reads `message`, so this is what the user
      // actually sees in the toast / auth form.
      res.status(400).json({
        message: describeErrors(result.errors),
        errors: result.errors,
      });
      return;
    }

    // Replace with the whitelisted, normalized values only.
    if (target === "body") {
      req.body = result.value;
    } else if (target === "query") {
      Object.keys(req.query).forEach((key) => delete req.query[key]);
      Object.assign(req.query, result.value);
    } else {
      Object.assign(req.params, result.value);
    }

    next();
  };
}

export const validateBody = (
  shape: ValidatorShape<Record<string, unknown>>,
  aliases: AliasMap = {},
) => validate("body", shape, aliases);

export const validateQuery = (
  shape: ValidatorShape<Record<string, unknown>>,
  aliases: AliasMap = {},
) => validate("query", shape, aliases);

export const validateParams = (
  shape: ValidatorShape<Record<string, unknown>>,
  aliases: AliasMap = {},
) => validate("params", shape, aliases);
