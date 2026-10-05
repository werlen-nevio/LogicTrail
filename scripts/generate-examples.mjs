// Regenerates the example outputs in docs/examples from the sample app (static analysis, no LLM).
// Run after `npm run build`: node scripts/generate-examples.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, resolveConfig, StaticProvider, writeOutputs } from "../dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sample = path.join(root, "examples/acme-shop");
const outDir = path.join(root, "docs/examples");

const flows = [
  { name: "login", question: "how does login work?" },
  { name: "checkout", question: "how does checkout work?" },
  { name: "payment-failure", question: "what happens when a payment fails?" },
];

for (const flow of flows) {
  const { graph } = await analyze({
    root: sample,
    question: flow.question,
    config: resolveConfig({ cache: false }),
    provider: new StaticProvider(),
  });
  // Committed examples must not contain the absolute path of the machine that generated them.
  delete graph.analysis.rootPath;
  graph.analysis.generatedAt = "2026-10-05T00:00:00.000Z";
  const written = await writeOutputs(graph, {
    outDir,
    name: flow.name,
    formats: ["html", "svg", "mermaid", "json"],
  });
  for (const file of written) console.log(path.relative(root, file.path));
}
