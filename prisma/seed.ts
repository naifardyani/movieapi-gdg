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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Add it to your .env file.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const moviesPath = path.join(import.meta.dirname, "../data/movies.json");
const movies: MovieSeed[] = JSON.parse(readFileSync(moviesPath, "utf8"));

async function main(): Promise<void> {
  for (const movie of movies) {
    // Fields match data/movies.json and the keys the frontend consumes.
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

    // Upsert keeps the curated ids (1..20) and makes re-running safe.
    await prisma.movie.upsert({
      where: { id: movie.id },
      update: data,
      create: { id: movie.id, ...data },
    });
  }

  const total = await prisma.movie.count();
  console.log(`Seeded ${movies.length} movies. Movies in database: ${total}.`);
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
