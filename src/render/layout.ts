import type { LogicNode, LogicTrailGraph } from "../graph/model.js";
import { createDagreGraph, runDagreLayout } from "./dagre.js";
import type { GraphLayout, LayoutEdge, LayoutNode, Point } from "./layout-types.js";

/** Approximate glyph widths of the monospace fonts used in node labels. */
const LABEL_CHAR = 7.6;
const META_CHAR = 6.7;
const EDGE_LABEL_CHAR = 6.3;
export const MAX_LABEL_CHARS = 40;
export const MAX_META_CHARS = 36;

export interface NodeText {
  label: string;
  meta?: string;
}

/** The (possibly shortened) text drawn inside a node. */
export function nodeText(node: LogicNode): NodeText {
  const label = truncate(node.label, MAX_LABEL_CHARS);
  if (node.type === "condition") return { label };
  if (!node.file) return { label };
  // Nodes show the last two path segments; the details panel has the full path.
  const short = node.file.split("/").slice(-2).join("/");
  const location = `${short}${node.line ? `:${node.line}` : ""}`;
  return { label, meta: truncatePath(location, MAX_META_CHARS) };
}

export function nodeSize(node: LogicNode): { width: number; height: number } {
  const text = nodeText(node);
  if (node.type === "condition") {
    return { width: clamp(text.label.length * LABEL_CHAR + 64, 120, 360), height: 40 };
  }
  const content = Math.max(text.label.length * LABEL_CHAR, (text.meta?.length ?? 0) * META_CHAR);
  if (node.type === "error" || node.type === "response") {
    return { width: clamp(content + 62, 130, 340), height: text.meta ? 50 : 36 };
  }
  return { width: clamp(content + 58, 150, 360), height: text.meta ? 54 : 40 };
}

export function layoutGraph(graph: LogicTrailGraph): GraphLayout {
  const g = createDagreGraph();
  g.setGraph({ rankdir: "TB", nodesep: 26, ranksep: 52, edgesep: 14, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) g.setNode(node.id, nodeSize(node));
  for (const edge of graph.edges) {
    const text = edge.label ? truncate(edge.label, 28) : undefined;
    g.setEdge(
      edge.from,
      edge.to,
      text ? { width: text.length * EDGE_LABEL_CHAR + 14, height: 18, labelpos: "c" } : {},
      edge.id,
    );
  }
  runDagreLayout(g);

  const nodes: LayoutNode[] = graph.nodes.map((node) => {
    const placed = g.node(node.id);
    return {
      id: node.id,
      x: round(placed.x),
      y: round(placed.y),
      width: placed.width,
      height: placed.height,
    };
  });
  const edges: LayoutEdge[] = graph.edges.map((edge) => {
    const placed = g.edge({ v: edge.from, w: edge.to, name: edge.id });
    const points = (placed.points ?? []).map((point) => ({ x: round(point.x), y: round(point.y) }));
    const text = edge.label ? truncate(edge.label, 28) : undefined;
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      points,
      path: curvePath(points),
      ...(text && placed.x !== undefined && placed.y !== undefined
        ? {
            label: {
              x: round(placed.x),
              y: round(placed.y),
              width: placed.width ?? text.length * EDGE_LABEL_CHAR + 14,
              height: placed.height ?? 18,
              text,
            },
          }
        : {}),
    };
  });
  const size = g.graph();
  return { width: Math.ceil(size.width ?? 0), height: Math.ceil(size.height ?? 0), nodes, edges };
}

/** B-spline through the points (same construction as d3's curveBasis). */
export function curvePath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const [first] = points;
  if (!first) return "";
  if (points.length < 3)
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
      .join(" ");
  const parts: string[] = [`M${first.x},${first.y}`];
  let x0 = first.x;
  let y0 = first.y;
  let x1 = points[1]?.x ?? first.x;
  let y1 = points[1]?.y ?? first.y;
  parts.push(`L${round((5 * x0 + x1) / 6)},${round((5 * y0 + y1) / 6)}`);
  for (let index = 2; index < points.length; index++) {
    const point = points[index];
    if (!point) continue;
    parts.push(
      `C${round((2 * x0 + x1) / 3)},${round((2 * y0 + y1) / 3)} ${round((x0 + 2 * x1) / 3)},${round((y0 + 2 * y1) / 3)} ${round((x0 + 4 * x1 + point.x) / 6)},${round((y0 + 4 * y1 + point.y) / 6)}`,
    );
    x0 = x1;
    y0 = y1;
    x1 = point.x;
    y1 = point.y;
  }
  parts.push(
    `C${round((2 * x0 + x1) / 3)},${round((2 * y0 + y1) / 3)} ${round((x0 + 2 * x1) / 3)},${round((y0 + 2 * y1) / 3)} ${x1},${y1}`,
  );
  return parts.join(" ");
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Shortens long paths from the left so the file name and line stay visible. */
export function truncatePath(text: string, max: number): string {
  if (text.length <= max) return text;
  const parts = text.split("/");
  while (parts.length > 1 && `…/${parts.join("/")}`.length > max) parts.shift();
  const result = `…/${parts.join("/")}`;
  return result.length > max ? `…${text.slice(text.length - max + 1)}` : result;
}
