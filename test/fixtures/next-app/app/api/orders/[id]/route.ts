import { NextResponse } from "next/server";
import { getOrder } from "@/lib/orders";

export const GET = async (_request: Request, { params }: { params: { id: string } }) => {
  const order = await getOrder(params.id);
  if (!order) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(order);
};
