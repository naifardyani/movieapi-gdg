/**
 * Watched / review controllers. Identity always comes from the token.
 */
import type { RequestHandler } from "express";
import * as watchedService from "../services/watched.service.js";
import { HttpError } from "../utils/HttpError.js";

function currentUserId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) {
    throw new HttpError(401, "Authentication required");
  }
  return req.user.id;
}

export const list: RequestHandler = async (req, res) => {
  res.status(200).json(await watchedService.listWatched(currentUserId(req)));
};

export const record: RequestHandler = async (req, res) => {
  const item = await watchedService.recordWatched(currentUserId(req), {
    movieId: req.body.movieId,
    rating: req.body.rating,
    review: req.body.review,
  });

  res.status(201).json(item);
};
