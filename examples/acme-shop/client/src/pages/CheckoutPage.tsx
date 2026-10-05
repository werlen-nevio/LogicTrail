import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { useNavigate } from "react-router-dom";
import { createOrder } from "@/api/orders";
import { useCart } from "@/hooks/useCart";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export function CheckoutPage() {
  const navigate = useNavigate();
  const { items, shippingAddressId } = useCart();
  const [submitting, setSubmitting] = useState(false);

  async function handleCheckout() {
    setSubmitting(true);
    const { orderId, clientSecret } = await createOrder(shippingAddressId);
    const stripe = await stripePromise;
    const result = await stripe!.confirmCardPayment(clientSecret);
    if (result.error) {
      setSubmitting(false);
      navigate(`/checkout/failed?order=${orderId}`);
      return;
    }
    navigate(`/orders/${orderId}`);
  }

  return (
    <section>
      <h1>Checkout</h1>
      <p>{items.length} items</p>
      <button onClick={handleCheckout} disabled={submitting}>
        Pay now
      </button>
    </section>
  );
}
