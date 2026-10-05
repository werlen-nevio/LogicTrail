import { GRAPH_SCHEMA_URL, type LogicTrailGraph } from "../graph/model.js";

export interface JsonOptions {
  /** Embedded source snippets make the JSON self-contained but larger. Default true. */
  snippets?: boolean;
}

export function renderJson(graph: LogicTrailGraph, options: JsonOptions = {}): string {
  const { $schema: _schema, ...rest } = graph;
  const output: LogicTrailGraph = {
    $schema: GRAPH_SCHEMA_URL,
    ...rest,
    ...(options.snippets === false && {
      nodes: graph.nodes.map(({ snippet: _snippet, ...node }) => node),
    }),
  };
  return `${JSON.stringify(output, null, 2)}\n`;
}
