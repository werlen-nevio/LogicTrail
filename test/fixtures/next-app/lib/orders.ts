import { eq } from "drizzle-orm";
import { db } from "./db";
import { orders } from "./schema";

export async function insertOrder(items: string[]) {
  const [order] = await db.insert(orders).values({ items }).returning();
  return order;
}

export async function getOrder(id: string) {
  const rows = await db.select().from(orders).where(eq(orders.id, id));
  return rows[0];
}
