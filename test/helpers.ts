import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCodeGraph, type CodeGraph } from "../src/analysis/code-graph.js";
import { Workspace } from "../src/analysis/workspace.js";
import type { FileFacts, Step, SymbolFact } from "../src/indexer/facts.js";
import { indexRepository } from "../src/indexer/indexer.js";
import { extractJavaScriptFacts } from "../src/lang/javascript/extract.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ACME_SHOP = path.resolve(here, "../examples/acme-shop");
export const NEXT_APP = path.resolve(here, "fixtures/next-app");
export const SERVER_FRAMEWORKS = path.resolve(here, "fixtures/server-frameworks");

export function facts(code: string, file = "src/example.ts"): FileFacts {
  return extractJavaScriptFacts({ path: file, content: code, hash: "test" });
}

export function symbol(fileFacts: FileFacts, qualifiedName: string): SymbolFact {
  const found = fileFacts.symbols.find((candidate) => candidate.qualifiedName === qualifiedName);
  if (!found) {
    throw new Error(
      `No symbol ${qualifiedName}; have ${fileFacts.symbols.map((s) => s.qualifiedName).join(", ")}`,
    );
  }
  return found;
}

/** Callee paths of all call steps, flattened through branches and catches. */
export function callPaths(steps: readonly Step[]): string[] {
  const result: string[] = [];
  for (const step of steps) {
    if (step.kind === "call") result.push(step.call.path.join("."));
    else if (step.kind === "branch")
      for (const arm of step.arms) result.push(...callPaths(arm.steps));
    else if (step.kind === "catch") result.push(...callPaths(step.steps));
  }
  return result;
}

const graphs = new Map<string, Promise<{ graph: CodeGraph; workspace: Workspace }>>();

/** Indexes a fixture repository once per test run. */
export function fixtureGraph(root: string): Promise<{ graph: CodeGraph; workspace: Workspace }> {
  let pending = graphs.get(root);
  if (!pending) {
    pending = indexRepository({ root, cacheDir: false }).then((index) => {
      const workspace = new Workspace(index.files, root);
      return { workspace, graph: buildCodeGraph(workspace) };
    });
    graphs.set(root, pending);
  }
  return pending;
}

export function nodeByLabel(graph: CodeGraph, label: string): string {
  for (const node of graph.nodes.values()) if (node.label === label) return node.id;
  throw new Error(`No node labelled ${label}`);
}

export function edgeLabels(graph: CodeGraph, fromLabel: string): string[] {
  const from = nodeByLabel(graph, fromLabel);
  return graph
    .out(from)
    .map((edge) => `${edge.kind}:${graph.nodes.get(edge.to)?.label ?? edge.to}`);
}
