/**
 * Central error handler.
 *
 * Always responds with `{ message }` (plus `errors` for validation failures)
 * because the frontend companion reads `responseData.message || responseData.error`
 * and shows it in a toast.
 *
 * Status mapping follows the bonus rubric:
 *   400 malformed/invalid input       401 unauthenticated
 *   403 authenticated but not owner   404 missing resource
 *   409 conflict with existing state  422 semantically unprocessable
 *   500 unexpected                    502/503 upstream (Gemini) failure
 */
import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { isProduction } from "../config/env.js";
import { HttpError } from "../utils/HttpError.js";

function isPrismaKnownError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function isPrismaValidationError(error: unknown): error is Prisma.PrismaClientValidationError {
  return error instanceof Prisma.PrismaClientValidationError;
}

function isPrismaInitError(error: unknown): error is Prisma.PrismaClientInitializationError {
  return error instanceof Prisma.PrismaClientInitializationError;
}

/** Body-parser failure (malformed JSON). */
function isJsonParseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { type?: unknown }).type === "entity.parse.failed" ||
      ((error as { name?: unknown }).name === "SyntaxError" && "body" in error))
  );
}

/** Payload larger than express.json({ limit }). */
function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { type?: unknown }).type === "entity.too.large"
  );
}

/** Error from the URL parser (e.g. malformed percent-encoding in :id). */
function isUriError(error: unknown): boolean {
  return error instanceof URIError;
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  // 1. Errors we threw deliberately.
  if (error instanceof HttpError) {
    res.status(error.status).json({
      message: error.message,
      ...(error.details === undefined ? {} : { errors: error.details }),
    });
    return;
  }

  // 2. Transport-level failures.
  if (isJsonParseError(error)) {
    res.status(400).json({ message: "Malformed JSON body" });
    return;
  }

  if (isPayloadTooLarge(error)) {
    res.status(413).json({ message: "Request body is too large" });
    return;
  }

  if (isUriError(error)) {
    res.status(400).json({ message: "Malformed URL parameter" });
    return;
  }

  // 3. Database failures.
  if (isPrismaKnownError(error)) {
    switch (error.code) {
      case "P2002": {
        // Unique constraint: report which field collided when Prisma tells us.
        const target = error.meta?.["target"];
        const fields = Array.isArray(target) ? target.join(", ") : typeof target === "string" ? target : undefined;
        res.status(409).json({
          message: fields ? `A record with that ${fields} already exists` : "A record with that value already exists",
        });
        return;
      }
      case "P2003":
        // Invalid foreign key: the referenced row does not exist.
        res.status(400).json({ message: "Related record does not exist" });
        return;
      case "P2000":
        res.status(400).json({ message: "A provided value is too long" });
        return;
      case "P2011":
        res.status(400).json({ message: "A required value is missing" });
        return;
      case "P2014":
        res.status(409).json({ message: "That change would break a required relation" });
        return;
      case "P2025":
        res.status(404).json({ message: "Record not found" });
        return;
      default:
        break;
    }
  }

  if (isPrismaValidationError(error)) {
    // Query/schema misuse: a bug in our code, never the client's fault.
    console.error("[error] Prisma validation error:", error);
    res.status(500).json({ message: "Internal server error" });
    return;
  }

  if (isPrismaInitError(error)) {
    console.error("[error] Database connection failed:", error);
    res.status(503).json({ message: "Database is currently unavailable" });
    return;
  }

  // 4. Unexpected: log server-side, never leak internals to the client.
  console.error("[error] Unhandled error:", error);

  res.status(500).json({
    message: "Internal server error",
    ...(isProduction ? {} : { detail: error instanceof Error ? error.message : String(error) }),
  });
};
