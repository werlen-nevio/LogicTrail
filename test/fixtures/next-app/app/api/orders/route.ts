import { NextResponse } from "next/server";
import { insertOrder } from "@/lib/orders";

export async function POST(request: Request) {
  const body = await request.json();
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "No items" }, { status: 400 });
  }
  const order = await insertOrder(body.items);
  return NextResponse.json(order, { status: 201 });
}
