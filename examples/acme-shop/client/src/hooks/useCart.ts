import { useEffect, useState } from "react";
import { api } from "@/api/client";

export function useCart() {
  const [items, setItems] = useState<{ productId: string; quantity: number }[]>([]);
  const [shippingAddressId] = useState("default");

  useEffect(() => {
    api.get("/cart").then((response) => setItems(response.data.items));
  }, []);

  return { items, shippingAddressId };
}
