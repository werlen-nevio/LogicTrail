import { db } from "../lib/db.js";

export interface CartLine {
  productId: string;
  quantity: number;
  price: number;
}

export interface Cart {
  userId: string;
  items: CartLine[];
}

export async function getCart(userId: string): Promise<Cart> {
  const items = await db.cartItem.findMany({ where: { userId }, include: { product: true } });
  return {
    userId,
    items: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.product.price,
    })),
  };
}

/** Checks that the cart is not empty and every quantity is positive. */
export function validateCart(cart: Cart): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (cart.items.length === 0) errors.push("Cart is empty");
  for (const item of cart.items) {
    if (item.quantity <= 0) errors.push(`Invalid quantity for ${item.productId}`);
  }
  return { ok: errors.length === 0, errors };
}

export function cartTotal(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
