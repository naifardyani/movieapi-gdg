/**
 * Movie controllers: catalogue listing, detail and AI recommendation.
 */
import type { RequestHandler } from "express";
import * as movieService from "../services/movie.service.js";
import { recommendMovie } from "../services/recommendation.service.js";

export const list: RequestHandler = async (req, res) => {
  const genre = typeof req.query.genre === "string" ? req.query.genre : undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;

  res.status(200).json(await movieService.listMovies({ genre, search }));
};

export const detail: RequestHandler = async (req, res) => {
  const id = Number(req.params.id);
  res.status(200).json(await movieService.getMovieById(id));
};

export const recommend: RequestHandler = async (req, res) => {
  res.status(200).json(await recommendMovie(req.body.prompt));
};
