import type { Request, Response } from "express";
import Stripe from "stripe";
import { markOrderFailed, markOrderPaid } from "../services/orderService.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

/** Creates a Stripe PaymentIntent for the order total. */
export async function createPaymentIntent(order: { id: string; total: number }) {
  return stripe.paymentIntents.create({
    amount: order.total,
    currency: "usd",
    metadata: { orderId: order.id },
  });
}

/** Verifies the Stripe signature and applies payment results to orders. */
export async function handleStripeWebhook(req: Request, res: Response) {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"] as string,
      process.env.STRIPE_WEBHOOK_SECRET ?? "",
    );
  } catch {
    return res.status(400).send("Invalid signature");
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markOrderPaid(intent.metadata.orderId);
      break;
    }
    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await markOrderFailed(
        intent.metadata.orderId,
        intent.last_payment_error?.message ?? "unknown",
      );
      break;
    }
  }

  return res.json({ received: true });
}
