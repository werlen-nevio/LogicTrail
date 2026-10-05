import { db } from "../lib/db.js";
import { sendPaymentFailedEmail } from "../email/send.js";
import { authEvents, orderEvents } from "./bus.js";

authEvents.on("user.loggedIn", async ({ userId }: { userId: string }) => {
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
});

orderEvents.on("order.paymentFailed", notifyPaymentFailed);

async function notifyPaymentFailed({ orderId }: { orderId: string }) {
  await sendPaymentFailedEmail(orderId);
}
