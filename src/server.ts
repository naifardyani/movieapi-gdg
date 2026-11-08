/**
 * Process entry point: starts the HTTP server and closes resources cleanly.
 */
import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";

const server = app.listen(env.PORT, () => {
  console.log(`[server] FilmLog API listening on http://localhost:${env.PORT}/api`);
  console.log(`[server] Environment: ${env.NODE_ENV}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[server] ${signal} received, shutting down...`);

  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log("[server] Database connection closed.");
      process.exit(0);
    } catch (error) {
      console.error("[server] Error during shutdown:", error);
      process.exit(1);
    }
  });

  // Do not hang forever if connections refuse to drain.
  setTimeout(() => {
    console.error("[server] Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Last-resort safety nets: log and exit non-zero rather than continuing in an
// unknown state. The HTTP error middleware already covers request-scoped errors.
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled promise rejection:", reason);
  void shutdown("unhandledRejection");
});

process.on("uncaughtException", (error) => {
  console.error("[server] Uncaught exception:", error);
  void shutdown("uncaughtException");
});
