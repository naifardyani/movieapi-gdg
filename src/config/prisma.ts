/**
 * Single Prisma Client instance for the whole process.
 *
 * Prisma 7 requires a driver adapter: `new PrismaClient()` without one throws
 * `PrismaClientInitializationError`. The instance is cached on globalThis so
 * `tsx watch` reloads do not leak a connection pool per save.
 */
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env, isProduction } from "./env.js";

const { PrismaClient } = pkg;

export type AppPrismaClient = InstanceType<typeof PrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma?: AppPrismaClient;
};

function createPrismaClient(): AppPrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma: AppPrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
