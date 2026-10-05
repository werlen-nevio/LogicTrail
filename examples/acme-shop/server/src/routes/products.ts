import { Router } from "express";
import { db } from "../lib/db.js";

const router = Router();

router.get("/", async (_req, res) => {
  const products = await db.product.findMany({ where: { stock: { gt: 0 } } });
  res.json(products);
});

router.get("/:id", async (req, res) => {
  const product = await db.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).json({ error: "Product not found" });
  return res.json(product);
});

export default router;
