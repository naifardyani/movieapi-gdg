import { Router } from "express";
import * as movieController from "../controllers/movie.controller.js";
import {
  isInt,
  isString,
  optional,
  validateBody,
  validateParams,
  validateQuery,
} from "../middlewares/validate.middleware.js";

const router = Router();

router.get(
  "/",
  validateQuery({
    genre: optional(isString(1, 50)),
    search: optional(isString(1, 100)),
  }),
  movieController.list,
);

// MUST be declared before "/:id", otherwise Express matches ":id" = "recommend".
router.post(
  "/recommend",
  validateBody({
    prompt: isString(3, 1000),
  }),
  movieController.recommend,
);

router.get(
  "/:id",
  validateParams({
    id: isInt(1),
  }),
  movieController.detail,
);

export default router;
