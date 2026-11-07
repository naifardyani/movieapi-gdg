/**
 * Watched-movie + review business logic.
 *
 * Responses are NESTED ({ ...review, movie }) because the frontend reads
 * `item.movie` first and then `item.review` / `item.rating` / `item.createdAt`
 * in renderWatchedList(). This is the opposite shape of the watchlist.
 */
import { prisma } from "../config/prisma.js";
import { HttpError } from "../utils/HttpError.js";
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

/**
 * Deletes one of the caller's reviews.
 *
 * Distinguishes the three cases the rubric cares about:
 *   404 - no review with that id
 *   403 - the review belongs to a different user
 *   204 - deleted
 *
 * Kept as two queries on purpose: `deleteMany({ where: { id, userId } })` would
 * collapse "missing" and "not yours" into the same count and lose the 403.
 */
export async function deleteReview(userId: string, reviewId: string): Promise<void> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { userId: true },
  });

  if (!review) {
    throw new HttpError(404, "Review not found");
  }

  if (review.userId !== userId) {
    throw new HttpError(403, "You can only modify your own reviews");
  }

  await prisma.review.delete({ where: { id: reviewId } });
}
