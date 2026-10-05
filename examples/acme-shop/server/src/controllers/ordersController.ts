import type { Request, Response } from "express";
import { createPaymentIntent } from "../payments/stripe.js";
import { getCart, validateCart } from "../services/cart.js";
import { OrderService } from "../services/orderService.js";

export class OrdersController {
  constructor(private readonly orders: OrderService) {}

  /** Turns the user's cart into an order and starts a Stripe payment. */
  create = async (req: Request, res: Response) => {
    const cart = await getCart(req.user.id);
    const validation = validateCart(cart);
    if (!validation.ok) {
      return res.status(400).json({ errors: validation.errors });
    }

    const order = await this.orders.createOrder(req.user.id, cart);
    const payment = await createPaymentIntent(order);

    return res.status(201).json({ orderId: order.id, clientSecret: payment.client_secret });
  };

  show = async (req: Request, res: Response) => {
    const order = await this.orders.findOrder(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.json(order);
  };
}

export const ordersController = new OrdersController(new OrderService());
