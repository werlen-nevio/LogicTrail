import { Worker } from "bullmq";
import { sendOrderConfirmation } from "../email/send.js";
import { redis } from "../lib/redis.js";

export const emailWorker = new Worker(
  "emails",
  async (job) => {
    if (job.name === "order-confirmation") {
      await sendOrderConfirmation(job.data.orderId);
    }
  },
  { connection: redis },
);
