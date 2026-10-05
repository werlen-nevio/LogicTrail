"use server";

import { insertOrder } from "@/lib/orders";

export async function saveDraft(form: FormData) {
  await insertOrder([String(form.get("sku"))]);
}
