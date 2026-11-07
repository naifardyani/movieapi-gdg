import { Router } from "express";
import * as watchlistController from "../controllers/watchlist.controller.js";
import { isInt, validateBody, validateParams } from "../middlewares/validate.middleware.js";

const router = Router();

router.get("/", watchlistController.list);

router.post(
  "/",
  // The frontend sends both `movieId` and `movie_id`.
  validateBody({ movieId: isInt(1) }, { movieId: ["movie_id"] }),
  watchlistController.add,
);

router.delete(
  "/:movieId",
  validateParams({
    movieId: isInt(1),
  }),
  watchlistController.remove,
);

export default router;
