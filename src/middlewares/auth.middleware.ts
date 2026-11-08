/**
 * JWT authentication middleware.
 *
 * Two checks, both mapped to 401 (never 403 — that is reserved for
 * "authenticated but not the owner"):
 *
 *   1. Signature + expiry. A bad/expired/malformed token is unauthenticated.
 *   2. Account existence. A token for a user who was deleted after it was
 *      issued must not proceed, otherwise the request would fail later as a
 *      foreign-key error (P2003) and leak an unrelated 400.
 *
 * Identity comes from the token subject only; handlers never read a userId
 * from the request body.
 */
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/HttpError.js";

function extractToken(header: string | undefined): string {
  if (!header || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }

  const token = header.slice("Bearer ".length).trim();
  if (token === "") {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }

  return token;
}

function verifyToken(token: string): string {
  let payload: string | jwt.JwtPayload;

  //every protected route will call this function to verify the token, and if the token is invalid or expired, it will throw an HttpError with a 401 status code and a message indicating the issue. This ensures that only authenticated users can access protected routes, which are watchlist and watched.
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (error) {
    // Distinguishing expiry helps the client decide to re-authenticate.
    if (error instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, "Token has expired");
    }
    throw new HttpError(401, "Invalid or expired token");
  }

  if (typeof payload === "string" || typeof payload.sub !== "string" || payload.sub === "") {
    throw new HttpError(401, "Invalid or expired token");
  }

  return payload.sub;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const subject = verifyToken(extractToken(req.headers.authorization));

  // Guards against tokens issued before the account was deleted.
  const user = await prisma.user.findUnique({
    where: { id: subject },
    select: { id: true },
  });

  if (!user) {
    throw new HttpError(401, "Account no longer exists");
  }

  req.user = { id: user.id };
  next();
};
