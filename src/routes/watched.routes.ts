import { Router } from "express";
import * as watchedController from "../controllers/watched.controller.js";
import { isInt, isText, validateBody } from "../middlewares/validate.middleware.js";

const router = Router();

router.get("/", watchedController.list);

router.post(
  "/",
  // The frontend sends `movieId`/`movie_id` and `review`/`opinion`.
  validateBody(
    {
      movieId: isInt(1),
      rating: isInt(1, 5),
      review: isText(1, 2000),
    },
    { movieId: ["movie_id"], review: ["opinion"] },
  ),
  watchedController.record,
);

export default router;
