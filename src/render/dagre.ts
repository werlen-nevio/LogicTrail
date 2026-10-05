import dagre from "@dagrejs/dagre";

/*
 * @dagrejs/dagre ships ESM type declarations with extensionless relative
 * imports, which do not resolve under NodeNext module resolution. This is
 * the small, typed surface of dagre that the layout uses.
 */

export interface DagreNodeLabel {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DagreEdgeLabel {
  points?: { x: number; y: number }[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface DagreGraph {
  setGraph(label: Record<string, unknown>): void;
  setDefaultEdgeLabel(factory: () => Record<string, unknown>): void;
  setNode(id: string, label: { width: number; height: number }): void;
  setEdge(from: string, to: string, label: Record<string, unknown>, name: string): void;
  node(id: string): DagreNodeLabel;
  edge(edge: { v: string; w: string; name: string }): DagreEdgeLabel;
  graph(): { width?: number; height?: number };
}

interface DagreModule {
  graphlib: { Graph: new (options: { multigraph: boolean }) => DagreGraph };
  layout(graph: DagreGraph): void;
}

const lib = dagre as unknown as DagreModule;

export function createDagreGraph(): DagreGraph {
  return new lib.graphlib.Graph({ multigraph: true });
}

export function runDagreLayout(graph: DagreGraph): void {
  lib.layout(graph);
}
