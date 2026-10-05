import type { LogicTrailGraph } from "../graph/model.js";

export interface JsonOptions {
  /** Embedded source snippets make the JSON self-contained but larger. Default true. */
  snippets?: boolean;
}

export function renderJson(graph: LogicTrailGraph, options: JsonOptions = {}): string {
  const output: LogicTrailGraph =
    options.snippets === false
      ? { ...graph, nodes: graph.nodes.map(({ snippet: _snippet, ...node }) => node) }
      : graph;
  return `${JSON.stringify(output, null, 2)}\n`;
}
