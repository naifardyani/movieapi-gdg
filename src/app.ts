/**
 * Express application composition root.
 * No business logic and no direct database access live here.
 */
import cors from "cors";
import express from "express";
import { errorHandler } from "./middlewares/error.middleware.js";
import { notFound } from "./middlewares/notFound.middleware.js";
import apiRoutes from "./routes/index.js";

export const app = express();

// The frontend companion is served from a different origin (or file://),
// so permissive CORS is required for the assignment workflow.
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "FilmLog API",
    version: "1.0.0",
    docs: "/api/health",
  });
});

app.use("/api", apiRoutes);

// Order matters: 404 for unmatched API routes, then the error handler.
app.use("/api", notFound);
app.use(errorHandler);

export default app;
