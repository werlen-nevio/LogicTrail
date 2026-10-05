import type { LanguageAdapter } from "../adapter.js";
import { extractJavaScriptFacts } from "./extract.js";
import { JavaScriptModuleResolver } from "./module-resolver.js";

export const javascriptAdapter: LanguageAdapter = {
  id: "javascript",
  extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  version: 1,
  extract: extractJavaScriptFacts,
  createModuleResolver: (context) => new JavaScriptModuleResolver(context),
};
