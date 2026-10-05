/** Renders loosely typed metadata values (strings, numbers, lists) as text. */
export function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => asText(item)).join(", ");
  return fallback;
}
