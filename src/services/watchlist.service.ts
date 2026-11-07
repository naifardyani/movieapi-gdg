/**
 * Watchlist business logic.
 *
 * Responses are FLATTENED ({ movieId, createdAt, ...movie }) because the
 * frontend reads `item.movieId` and `item.poster_url` / `item.title` / `item.year`
 * from the same object in renderWatchlistGrid().
 */
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/HttpError.js";
import { assertMovieExists } from "./movie.service.js";

export type WatchlistItem = {
  movieId: number;
  createdAt: Date;
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

export async function listWatchlist(userId: string): Promise<WatchlistItem[]> {
  const rows = await prisma.watchlist.findMany({
    where: { userId },
    include: { movie: true },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((row) => ({
    ...row.movie,
    movieId: row.movieId,
    createdAt: row.createdAt,
  }));
}

export async function addToWatchlist(userId: string, movieId: number): Promise<WatchlistItem> {
  await assertMovieExists(movieId);

  const existing = await prisma.watchlist.findUnique({
    where: { userId_movieId: { userId, movieId } },
    select: { id: true },
  });

  if (existing) {
    throw new HttpError(409, "Movie is already in your watchlist");
  }

  const row = await prisma.watchlist.create({
    data: { userId, movieId },
    include: { movie: true },
  });

  return {
    ...row.movie,
    movieId: row.movieId,
    createdAt: row.createdAt,
  };
}

/**
 * deleteMany (not delete) so a missing row yields count 0 instead of a
 * Prisma P2025 exception; the 404 is then explicit and meaningful.
 */
export async function removeFromWatchlist(userId: string, movieId: number): Promise<void> {
  const { count } = await prisma.watchlist.deleteMany({
    where: { userId, movieId },
  });

  if (count === 0) {
    throw new HttpError(404, "Movie is not in your watchlist");
  }
}
