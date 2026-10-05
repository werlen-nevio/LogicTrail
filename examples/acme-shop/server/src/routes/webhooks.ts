import express, { Router } from "express";
import { handleStripeWebhook } from "../payments/stripe.js";

const router = Router();

router.post("/stripe", express.raw({ type: "application/json" }), handleStripeWebhook);

export default router;
