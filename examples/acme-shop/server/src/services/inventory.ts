import { db } from "../lib/db.js";
import type { CartLine } from "./cart.js";

export class OutOfStockError extends Error {
  constructor(readonly productId: string) {
    super(`Product ${productId} is out of stock`);
  }
}

/** Decrements stock for every cart line; fails if a product runs out. */
export async function reserveInventory(items: CartLine[]) {
  for (const item of items) {
    const product = await db.product.update({
      where: { id: item.productId },
      data: { stock: { decrement: item.quantity } },
    });
    if (product.stock < 0) {
      throw new OutOfStockError(item.productId);
    }
  }
}

export async function releaseInventory(orderId: string) {
  const lines = await db.cartItem.findMany({ where: { orderId } });
  for (const line of lines) {
    await db.product.update({
      where: { id: line.productId },
      data: { stock: { increment: line.quantity } },
    });
  }
}
