import { Router } from "express";
import { authController } from "../controllers/authController.js";
import { loginRateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { validateBody } from "../middleware/validate.js";
import { loginSchema } from "../schemas/auth.js";

const router = Router();

router.post("/login", loginRateLimit, validateBody(loginSchema), authController.login);
router.post("/logout", requireAuth, authController.logout);
router.get("/me", requireAuth, authController.me);

export default router;
