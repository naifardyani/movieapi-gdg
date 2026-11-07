/**
 * Database seed: loads the curated catalogue from data/movies.json.
 *
 * Run with `npm run db:seed` (wired through prisma7.config.ts).
 *
 * Prisma 7 requires a driver adapter, so the client is constructed here with
 * PrismaPg. The seed runs in its own process launched by the Prisma CLI, which
 * is why it does not reuse src/config/prisma.ts.
 *
 * Validation happens before any write: if data/movies.json is malformed the
 * script fails with a readable message instead of a Prisma exception halfway
 * through the catalogue.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import "dotenv/config";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const { PrismaClient } = pkg;

type MovieSeed = {
  id: number;
  title: string;
  year: number;
  director: string;
  genres: string[];
  rating: number;
  duration: string;
  synopsis: string;
  poster_url: string;
  cast: string[];
};

/** Raised for problems with the seed source file, before touching the database. */
class SeedDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedDataError";
  }
}

function fail(message: string): never {
  throw new SeedDataError(message);
}

/* -------------------------------------------------------------------------- */
/*                                   Config                                   */
/* -------------------------------------------------------------------------- */

function readConnectionString(): string {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim() === "") {
    fail("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }

  return connectionString;
}

/* -------------------------------------------------------------------------- */
/*                              Source validation                             */
/* -------------------------------------------------------------------------- */

function loadMovies(): MovieSeed[] {
  const moviesPath = path.join(import.meta.dirname, "../data/movies.json");

  let raw: string;
  try {
    raw = readFileSync(moviesPath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`Cannot read ${moviesPath}: ${reason}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`data/movies.json is not valid JSON: ${reason}`);
  }

  if (!Array.isArray(parsed)) {
    fail("data/movies.json must contain a JSON array of movies");
  }

  if (parsed.length === 0) {
    fail("data/movies.json is empty; nothing to seed");
  }

  const seenIds = new Set<number>();
  const movies: MovieSeed[] = [];

  parsed.forEach((entry: unknown, index: number) => {
    const where = `data/movies.json[${index}]`;

    if (typeof entry !== "object" || entry === null) {
      fail(`${where} is not an object`);
    }

    const record = entry as Record<string, unknown>;

    const id = record["id"];
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      fail(`${where}.id must be a positive integer`);
    }
    if (seenIds.has(id)) {
      fail(`${where}.id duplicates id ${id}`);
    }
    seenIds.add(id);

    const title = record["title"];
    if (typeof title !== "string" || title.trim() === "") {
      fail(`${where}.title must be a non-empty string`);
    }

    const year = record["year"];
    if (typeof year !== "number" || !Number.isInteger(year)) {
      fail(`${where}.year must be an integer`);
    }

    const director = record["director"];
    if (typeof director !== "string" || director.trim() === "") {
      fail(`${where}.director must be a non-empty string`);
    }

    const genres = record["genres"];
    if (!Array.isArray(genres) || genres.some((g) => typeof g !== "string")) {
      fail(`${where}.genres must be an array of strings`);
    }

    const rating = record["rating"];
    if (typeof rating !== "number" || Number.isNaN(rating)) {
      fail(`${where}.rating must be a number`);
    }

    const duration = record["duration"];
    if (typeof duration !== "string" || duration.trim() === "") {
      fail(`${where}.duration must be a non-empty string`);
    }

    const synopsis = record["synopsis"];
    if (typeof synopsis !== "string" || synopsis.trim() === "") {
      fail(`${where}.synopsis must be a non-empty string`);
    }

    const posterUrl = record["poster_url"];
    if (typeof posterUrl !== "string" || posterUrl.trim() === "") {
      fail(`${where}.poster_url must be a non-empty string`);
    }

    const cast = record["cast"];
    if (!Array.isArray(cast) || cast.some((c) => typeof c !== "string")) {
      fail(`${where}.cast must be an array of strings`);
    }

    movies.push({
      id,
      title: title.trim(),
      year,
      director: director.trim(),
      genres,
      rating,
      duration: duration.trim(),
      synopsis: synopsis.trim(),
      poster_url: posterUrl.trim(),
      cast,
    });
  });

  return movies;
}

/* -------------------------------------------------------------------------- */
/*                                    Seed                                    */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const connectionString = readConnectionString();
  const movies = loadMovies();

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    // Upsert keeps the curated ids (1..20) and makes re-running safe.
    for (const movie of movies) {
      const data = {
        title: movie.title,
        year: movie.year,
        director: movie.director,
        genres: movie.genres,
        rating: movie.rating,
        duration: movie.duration,
        synopsis: movie.synopsis,
        poster_url: movie.poster_url,
        cast: movie.cast,
      };

      await prisma.movie.upsert({
        where: { id: movie.id },
        update: data,
        create: { id: movie.id, ...data },
      });
    }

    const total = await prisma.movie.count();
    console.log(`Seeded ${movies.length} movies. Movies in database: ${total}.`);

    if (total < movies.length) {
      fail(`Expected at least ${movies.length} movies after seeding, found ${total}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof SeedDataError) {
    console.error(`\n[seed] Invalid seed data: ${error.message}\n`);
  } else {
    console.error("\n[seed] Seeding failed:", error, "\n");
  }

  process.exitCode = 1;
});
