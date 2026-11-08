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

/**
 * Supabase's shared pooler (Supavisor) caps connections per role, and `pg`
 * defaults to a pool of 10. A small explicit pool keeps a single Render
 * instance comfortably inside that cap. Override with `DB_POOL_MAX` if needed.
 */
function poolSize(): number {
  const raw = process.env["DB_POOL_MAX"];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

function createPrismaClient(): AppPrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: poolSize(),
  });
  return new PrismaClient({ adapter });
}

export const prisma: AppPrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
