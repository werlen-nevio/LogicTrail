import { api } from "./client";

export interface CreatedOrder {
  orderId: string;
  clientSecret: string;
}

export async function createOrder(shippingAddressId: string): Promise<CreatedOrder> {
  const response = await api.post("/orders", { shippingAddressId });
  return response.data;
}

export async function fetchProducts() {
  const response = await api.get("/products");
  return response.data;
}
