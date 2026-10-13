import type { ArgFact } from "../../indexer/facts.js";
import { isPackage, packageValue, type Classification, type FrameworkAdapter } from "./types.js";

const CACHE_OPERATIONS = new Set(["revalidateTag", "revalidatePath", "updateTag", "refresh"]);
const REQUEST_STORES: Readonly<Record<string, string>> = {
  cookies: "cookies",
  headers: "request headers",
};
const STORE_OPERATIONS = new Set(["get", "getAll", "has", "set", "delete"]);

/**
 * Next.js request and cache APIs: `revalidateTag(TAGS.cart)`, `updateTag("cart")`,
 * `(await cookies()).get("cartId")` and `(await headers()).get("x-topic")`. A bare `cookies()`
 * only obtains the store, so it is not a step; the store's operations are.
 */
export const nextAdapter: FrameworkAdapter = {
  name: "next",
  classify({ value, call, workspace, file, symbol }): Classification | undefined {
    const pkg = packageValue(value);
    if (!pkg) return undefined;
    const text = (arg: ArgFact | undefined): string | undefined => {
      if (arg?.kind === "string") return JSON.stringify(arg.value);
      if (arg?.kind !== "path") return undefined;
      const resolved = workspace.resolvePath(file, symbol, arg.path);
      return resolved.kind === "string" ? JSON.stringify(resolved.value) : arg.path.join(".");
    };

    if (isPackage(pkg, "next/cache") && pkg.ops.length === 0 && pkg.member.length === 0) {
      if (!CACHE_OPERATIONS.has(pkg.imported)) return undefined;
      return {
        kind: "library",
        package: "next/cache",
        operation: pkg.imported,
        category: "cache",
        label: `${pkg.imported}(${text(call.args[0]) ?? ""})`,
      };
    }

    const category = REQUEST_STORES[pkg.imported];
    if (!isPackage(pkg, "next/headers") || !category) return undefined;
    // `(await cookies()).get(…)` is a chain on the call; `store.get(…)` a member of its result.
    const step =
      pkg.ops.length === 0 && pkg.member.length === 0
        ? call.chain[0]
        : pkg.ops.length === 1 && pkg.member.length === 1
          ? { name: pkg.member[0] ?? "", args: call.args }
          : undefined;
    if (!step || !STORE_OPERATIONS.has(step.name)) return undefined;
    const key = text(step.args[0]);
    return {
      kind: "library",
      package: "next/headers",
      operation: step.name,
      category,
      label: `${pkg.imported}().${step.name}(${key ?? ""})`,
    };
  },
};
