/**
 * Augments Express's Request with the authenticated user, attached by
 * auth.middleware.ts after a successful JWT verification.
 */
import "express";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
    }
  }
}

export {};
