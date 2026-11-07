/**
 * Watched-movie + review business logic.
 *
 * Responses are NESTED ({ ...review, movie }) because the frontend reads
 * `item.movie` first and then `item.review` / `item.rating` / `item.createdAt`
 * in renderWatchedList(). This is the opposite shape of the watchlist.
 */
import { prisma } from "../config/prisma.js";
import { assertMovieExists } from "./movie.service.js";

export type WatchedItem = Awaited<ReturnType<typeof listWatched>>[number];

export async function listWatched(userId: string) {
  return prisma.review.findMany({
    where: { userId },
    include: { movie: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function recordWatched(
  userId: string,
  input: { movieId: number; rating: number; review: string },
) {
  await assertMovieExists(input.movieId);

  // upsert on @@unique([userId, movieId]): re-rating updates instead of a 409.
  return prisma.review.upsert({
    where: { userId_movieId: { userId, movieId: input.movieId } },
    update: { rating: input.rating, review: input.review },
    create: {
      userId,
      movieId: input.movieId,
      rating: input.rating,
      review: input.review,
    },
    include: { movie: true },
  });
}
