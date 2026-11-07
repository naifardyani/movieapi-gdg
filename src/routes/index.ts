/**
 * Mounts every feature router under /api.
 * Protected routers get requireAuth at the mount point, so no individual
 * route can accidentally be left unauthenticated.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import authRoutes from "./auth.routes.js";
import movieRoutes from "./movie.routes.js";
import watchedRoutes from "./watched.routes.js";
import watchlistRoutes from "./watchlist.routes.js";

const api = Router();

api.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

api.use("/auth", authRoutes);
api.use("/movies", movieRoutes);
api.use("/watchlist", requireAuth, watchlistRoutes);
api.use("/watched", requireAuth, watchedRoutes);

export default api;
