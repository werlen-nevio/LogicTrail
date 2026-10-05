import { isPackage, packageValue, stringOrTemplateArg, type FrameworkAdapter } from "./types.js";

function cleanTarget(target: string): string {
  const withoutQuery = target.split(/[?#]/)[0] ?? target;
  return withoutQuery.replace(/\$\{[^}]*\}/g, ":param") || "/";
}

export const navigationAdapter: FrameworkAdapter = {
  name: "navigation",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg) return undefined;
    const target = stringOrTemplateArg(call.args[0]);
    if (!target?.startsWith("/") && !target?.startsWith("${")) return undefined;

    if (
      isPackage(
        pkg,
        "react-router",
        "react-router-dom",
        "@remix-run/react",
        "@tanstack/react-router",
      )
    ) {
      const fromHook =
        pkg.ops.some((op) => op.op === "call") &&
        pkg.member.length === 0 &&
        pkg.imported === "useNavigate";
      const redirect =
        pkg.ops.length === 0 && pkg.member.length === 0 && pkg.imported === "redirect";
      if (fromHook || redirect)
        return { kind: "navigate", to: cleanTarget(target), framework: "react-router" };
    }
    if (isPackage(pkg, "next/navigation", "next/router")) {
      const method = pkg.member[0];
      const fromRouter =
        (pkg.ops.length > 0 && pkg.imported === "useRouter") ||
        (pkg.ops.length === 0 && pkg.imported === "default");
      if (fromRouter && (method === "push" || method === "replace") && pkg.member.length === 1) {
        return { kind: "navigate", to: cleanTarget(target), framework: "next" };
      }
    }
    return undefined;
  },
};
