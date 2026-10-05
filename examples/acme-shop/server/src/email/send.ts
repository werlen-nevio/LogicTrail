import { Resend } from "resend";
import { db } from "../lib/db.js";

const resend = new Resend(process.env.RESEND_API_KEY);

/** Emails the customer a receipt for a paid order. */
export async function sendOrderConfirmation(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { user: true } });
  if (!order) return;
  await resend.emails.send({
    from: "Acme <orders@acme.test>",
    to: order.user.email,
    subject: `Order ${order.id} confirmed`,
    html: `<p>Thanks for your order!</p>`,
  });
}

export async function sendPaymentFailedEmail(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { user: true } });
  if (!order) return;
  await resend.emails.send({
    from: "Acme <orders@acme.test>",
    to: order.user.email,
    subject: "Your payment failed",
    html: `<p>Please update your payment method.</p>`,
  });
}
