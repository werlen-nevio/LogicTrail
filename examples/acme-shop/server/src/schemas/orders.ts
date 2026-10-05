import { z } from "zod";

export const createOrderSchema = z.object({
  shippingAddressId: z.string(),
});
