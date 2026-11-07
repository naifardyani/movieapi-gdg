/**
 * Watchlist controllers. Identity always comes from the token (req.user),
 * never from the request body.
 */
import type { RequestHandler } from "express";
import * as watchlistService from "../services/watchlist.service.js";
import { HttpError } from "../utils/HttpError.js";

function currentUserId(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) {
    throw new HttpError(401, "Authentication required");
  }
  return req.user.id;
}

export const list: RequestHandler = async (req, res) => {
  res.status(200).json(await watchlistService.listWatchlist(currentUserId(req)));
};

export const add: RequestHandler = async (req, res) => {
  const item = await watchlistService.addToWatchlist(currentUserId(req), req.body.movieId);
  res.status(201).json(item);
};

export const remove: RequestHandler = async (req, res) => {
  await watchlistService.removeFromWatchlist(currentUserId(req), Number(req.params.movieId));
  res.status(204).send();
};
