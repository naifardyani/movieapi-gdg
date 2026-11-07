import { Router } from "express";
import * as authController from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { isEmail, isPassword, isString, validateBody } from "../middlewares/validate.middleware.js";

const router = Router();

router.post(
  "/register",
  validateBody({
    email: isEmail,
    password: isPassword,
    username: isString(1, 50),
  }),
  authController.register,
);

router.post(
  "/login",
  validateBody({
    email: isEmail,
    password: isString(1, 128),
  }),
  authController.login,
);

router.get("/me", requireAuth, authController.me);

export default router;
