import { Router } from "express";
import { ordersController } from "../controllers/ordersController.js";
import { validateBody } from "../middleware/validate.js";
import { createOrderSchema } from "../schemas/orders.js";

const router = Router();

router.post("/", validateBody(createOrderSchema), ordersController.create);
router.get("/:id", ordersController.show);

export default router;
