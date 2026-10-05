import type { LanguageAdapter } from "./adapter.js";
import { javascriptAdapter } from "./javascript/index.js";

/** All built-in language adapters. Add new languages here. */
export const languageAdapters: readonly LanguageAdapter[] = [javascriptAdapter];

export function adapterForFile(
  filePath: string,
  adapters: readonly LanguageAdapter[] = languageAdapters,
): LanguageAdapter | undefined {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts"))
    return undefined;
  if (/\.min\.[cm]?js$/.test(lower)) return undefined;
  return adapters.find((adapter) =>
    adapter.extensions.some((extension) => lower.endsWith(extension)),
  );
}
