import { dataAdapters } from "./data.js";
import { eventAdapters } from "./events.js";
import { httpAdapters } from "./http.js";
import { navigationAdapter } from "./navigation.js";
import { serviceAdapters } from "./services.js";
import type { CallSiteContext, Classification, FrameworkAdapter } from "./types.js";

/**
 * Built-in framework adapters, in priority order. Data adapters come before
 * the generic SDK adapter so e.g. Firestore calls through `firebase-admin`
 * are classified as database operations, not generic Firebase calls.
 */
export const frameworkAdapters: readonly FrameworkAdapter[] = [
  ...dataAdapters,
  ...httpAdapters,
  ...eventAdapters,
  navigationAdapter,
  ...serviceAdapters,
];

export function classifyCall(
  context: CallSiteContext,
  adapters: readonly FrameworkAdapter[] = frameworkAdapters,
): { classification: Classification; adapter: string } | undefined {
  for (const adapter of adapters) {
    const classification = adapter.classify(context);
    if (classification) return { classification, adapter: adapter.name };
  }
  return undefined;
}

export type { CallSiteContext, Classification, FrameworkAdapter } from "./types.js";
