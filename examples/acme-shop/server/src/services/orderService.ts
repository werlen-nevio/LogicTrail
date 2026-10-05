import { db } from "../lib/db.js";
import { orderEvents } from "../events/bus.js";
import { emailQueue } from "../jobs/queue.js";
import { cartTotal, type Cart } from "./cart.js";
import { releaseInventory, reserveInventory } from "./inventory.js";

export class OrderService {
  /** Persists a pending order and reserves stock for its items. */
  async createOrder(userId: string, cart: Cart) {
    const order = await db.order.create({
      data: { userId, status: "pending", total: cartTotal(cart) },
    });
    await reserveInventory(cart.items);
    orderEvents.emit("order.created", { orderId: order.id });
    return order;
  }

  async findOrder(orderId: string, userId: string) {
    return db.order.findFirst({ where: { id: orderId, userId } });
  }
}

/** Marks an order as paid and queues the confirmation email. */
export async function markOrderPaid(orderId: string) {
  await db.order.update({ where: { id: orderId }, data: { status: "paid" } });
  await emailQueue.add("order-confirmation", { orderId });
}

/** Marks an order as failed, releases its stock and notifies listeners. */
export async function markOrderFailed(orderId: string, reason: string) {
  await db.order.update({ where: { id: orderId }, data: { status: "payment_failed" } });
  await releaseInventory(orderId);
  orderEvents.emit("order.paymentFailed", { orderId, reason });
}
