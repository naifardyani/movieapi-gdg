/**
 * Movie catalogue queries: listing with optional filters and detail lookup.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/HttpError.js";

export type MovieFilters = {
  genre?: string;
  search?: string;
};

export async function listMovies(filters: MovieFilters) {
  const where: Prisma.MovieWhereInput = {};

  if (filters.genre) {
    // Postgres text[] column: `has` matches one array element exactly.
    where.genres = { has: filters.genre };
  }

  if (filters.search) {
    where.OR = [
      { title: { contains: filters.search, mode: "insensitive" } },
      { director: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  return prisma.movie.findMany({
    where,
    orderBy: { id: "asc" },
  });
}

export async function getMovieById(id: number) {
  const movie = await prisma.movie.findUnique({ where: { id } });

  if (!movie) {
    throw new HttpError(404, "Movie not found");
  }

  return movie;
}

/** Ensures a movie exists; used before creating watchlist/review rows. */
export async function assertMovieExists(id: number): Promise<void> {
  const movie = await prisma.movie.findUnique({ where: { id }, select: { id: true } });

  if (!movie) {
    throw new HttpError(404, "Movie not found");
  }
}
