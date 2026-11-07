/**
 * Dependency-free request validation middleware.
 *
 * Every validator returns the *normalized* value, and the middleware replaces
 * req.body / req.query / req.params with only the validated keys. Unknown keys
 * (for example a client-supplied `userId`) are silently dropped, which is what
 * makes ownership checks structural instead of something every handler must
 * remember to do.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ValidationResult, Validator, ValidatorShape } from "../types/validators.js";

const MAX_STRING_LENGTH = 10_000;

/* -------------------------------------------------------------------------- */
/*                              Primitive validators                          */
/* -------------------------------------------------------------------------- */

export const isString =
  (min = 1, max = 500): Validator<string> =>
  (input) => {
    if (typeof input !== "string") {
      return { ok: false, errors: ["must be a string"] };
    }
    const value = input.trim();
    if (value.length < min || value.length > max) {
      return { ok: false, errors: [`must be between ${min} and ${max} characters`] };
    }
    return { ok: true, value };
  };

/** Free-form text (reviews, prompts): trimmed, length-bounded. */
export const isText = (min = 1, max = MAX_STRING_LENGTH): Validator<string> => isString(min, max);

export const isEmail: Validator<string> = (input) => {
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

export const isPassword: Validator<string> = (input) => {
  if (typeof input !== "string") {
    return { ok: false, errors: ["must be a string"] };
  }
  if (input.length < 6 || input.length > 128) {
    return { ok: false, errors: ["must be between 6 and 128 characters"] };
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
    const parsed =
      typeof input === "number"
        ? input
        : typeof input === "string" && input.trim() !== ""
          ? Number(input)
          : Number.NaN;

    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return { ok: false, errors: [`must be an integer between ${min} and ${max}`] };
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

function validate(
  target: Target,
  shape: ValidatorShape<Record<string, unknown>>,
  aliases: AliasMap,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = runShape(shape, req[target], aliases);

    if (!result.ok) {
      res.status(422).json({
        message: "Validation failed",
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
