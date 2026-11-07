/**
 * JWT authentication middleware.
 *
 * Attaches `req.user = { id }` derived from the token subject. Handlers must
 * never read a userId from the request body: identity comes from the token only.
 */
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../utils/HttpError.js";

export type AuthTokenPayload = { sub: string };

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }

  const token = header.slice("Bearer ".length).trim();
  if (token === "") {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);

    if (typeof payload === "string" || typeof payload.sub !== "string" || payload.sub === "") {
      throw new Error("Token is missing a subject");
    }

    req.user = { id: payload.sub };
    next();
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
};
