"use client";

import { useRouter } from "next/navigation";
import { saveDraft } from "@/app/actions";

export default function CheckoutPage() {
  const router = useRouter();

  async function placeOrder() {
    const response = await fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({ items: ["sku-1"] }),
    });
    const order = await response.json();
    router.push(`/orders/${order.id}`);
  }

  return (
    <form action={saveDraft}>
      <button type="button" onClick={placeOrder}>
        Place order
      </button>
    </form>
  );
}
