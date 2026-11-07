import type { RequestHandler } from "express";

/** Terminal handler for unmatched routes, mounted under /api. */
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};
