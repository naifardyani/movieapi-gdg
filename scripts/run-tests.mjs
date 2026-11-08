/**
 * Test runner.
 *
 * Runs the suite against a dedicated throwaway database (`watchlist_test`) so
 * development data is never touched.
 *
 *   1. Drop + recreate `watchlist_test` (guarantees a clean slate).
 *   2. Push the current Prisma schema into it.
 *   3. Seed the 20 catalogue movies with the real seed script.
 *   4. Run `node:test` through tsx with DATABASE_URL pointed at the test DB.
 *
 * No extra dependencies: `pg` and `tsx` already exist in the project.
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";
import "dotenv/config";
import pg from "pg";

const TEST_DATABASE = "watchlist_test";

const configured = process.env["DATABASE_URL"];
if (configured === undefined || configured.trim() === "") {
  console.error("[tests] DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

if (process.env["NODE_ENV"] === "production") {
  console.error("[tests] Refusing to run: NODE_ENV=production.");
  process.exit(1);
}

/** Swaps the database name in a PostgreSQL connection URL. */
function withDatabase(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

const testUrl = withDatabase(configured, TEST_DATABASE);
const target = new URL(testUrl);

if (!target.pathname.endsWith("_test")) {
  console.error(`[tests] Refusing to run against non-test database: ${target.pathname}`);
  process.exit(1);
}

function run(command, args, env = {}) {
  execFileSync(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
}

console.log(`[tests] Target database: ${target.host}${target.pathname}`);

const admin = new pg.Client({ connectionString: withDatabase(configured, "postgres") });

try {
  await admin.connect();
} catch (error) {
  console.error("[tests] Cannot reach PostgreSQL:", error.message);
  process.exit(1);
}

try {
  // Terminate leftover connections so the drop cannot fail.
  await admin.query(
    `select pg_terminate_backend(pid) from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()`,
    [TEST_DATABASE],
  );
  // Identifiers cannot be parameterized; TEST_DATABASE is a hard-coded constant.
  await admin.query(`drop database if exists "${TEST_DATABASE}"`);
  await admin.query(`create database "${TEST_DATABASE}"`);
  console.log(`[tests] Recreated database ${TEST_DATABASE}`);
} finally {
  await admin.end();
}

console.log("[tests] Applying schema and seeding...");
run("npx", ["prisma", "db", "push", "--url", testUrl], { DATABASE_URL: testUrl });
run("node", ["prisma/seed.ts"], { DATABASE_URL: testUrl });

console.log("[tests] Running suite...\n");
run(
  "npx",
  [
    "tsx",
    "--test",
    "--test-concurrency=1",
    "tests/unit/**/*.test.ts",
    "tests/integration/**/*.test.ts",
  ],
  { DATABASE_URL: testUrl, NODE_ENV: "test" },
);
