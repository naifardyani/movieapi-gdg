/**
 * Central error handler.
 *
 * Always responds with `{ message }` (plus `errors` for validation failures)
 * because the frontend companion reads `responseData.message || responseData.error`
 * and shows it in a toast.
 */
import type { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { isProduction } from "../config/env.js";
import { HttpError } from "../utils/HttpError.js";

function isPrismaKnownError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
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

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      message: error.message,
      ...(error.details === undefined ? {} : { errors: error.details }),
    });
    return;
  }

  if (isJsonParseError(error)) {
    res.status(400).json({ message: "Malformed JSON body" });
    return;
  }

  if (isPrismaKnownError(error)) {
    switch (error.code) {
      case "P2002":
        res.status(409).json({ message: "A record with that value already exists" });
        return;
      case "P2025":
        res.status(404).json({ message: "Record not found" });
        return;
      case "P2003":
        res.status(400).json({ message: "Related record does not exist" });
        return;
      case "P2000":
        res.status(400).json({ message: "A provided value is too long" });
        return;
      default:
        break;
    }
  }

  // Unexpected: log server-side, never leak internals to the client.
  console.error("[error] Unhandled error:", error);

  res.status(500).json({
    message: "Internal server error",
    ...(isProduction ? {} : { detail: error instanceof Error ? error.message : String(error) }),
  });
};
