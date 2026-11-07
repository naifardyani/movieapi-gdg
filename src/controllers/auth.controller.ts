/**
 * Auth controllers: translate validated input into service calls and responses.
 */
import type { RequestHandler } from "express";
import * as authService from "../services/auth.service.js";
import { HttpError } from "../utils/HttpError.js";

export const register: RequestHandler = async (req, res) => {
  const user = await authService.register({
    email: req.body.email,
    password: req.body.password,
    username: req.body.username,
  });

  res.status(201).json(user);
};

export const login: RequestHandler = async (req, res) => {
  const result = await authService.login({
    email: req.body.email,
    password: req.body.password,
  });

  res.status(200).json(result);
};

export const me: RequestHandler = async (req, res) => {
  if (!req.user) {
    throw new HttpError(401, "Authentication required");
  }

  res.status(200).json(await authService.getPublicUser(req.user.id));
};
