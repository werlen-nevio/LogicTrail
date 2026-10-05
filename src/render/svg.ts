import type { LogicEdge, LogicNode, LogicTrailGraph } from "../graph/model.js";
import { layoutGraph, nodeText } from "./layout.js";
import type { GraphLayout, LayoutEdge, LayoutNode } from "./layout-types.js";
import { FONT_VARIABLES, GRAPH_CSS, NODE_ICONS, themeVariables } from "./theme.js";

export type Theme = "auto" | "light" | "dark";

const HEADER_HEIGHT = 64;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MARKERS: readonly [string, string][] = [
  ["lt-arrow", "lt-arrow"],
  ["lt-arrow-database", "lt-arrow lt-arrow--database"],
  ["lt-arrow-route", "lt-arrow lt-arrow--route"],
  ["lt-arrow-event", "lt-arrow lt-arrow--event"],
  ["lt-arrow-accent", "lt-arrow lt-arrow--accent"],
];

export function renderMarkers(): string {
  const markers = MARKERS.map(
    ([id, className]) =>
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="${className}" d="M0,1 L9,5 L0,9 z"/></marker>`,
  ).join("");
  return `<defs>${markers}</defs>`;
}

/**
 * The graph drawing (edges and nodes) without an outer <svg>. Used by the
 * standalone SVG document and embedded in the interactive HTML viewer.
 */
export function renderGraphMarkup(graph: LogicTrailGraph, layout: GraphLayout): string {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const entries = new Set(graph.entryPoints);
  const edgeMarkup = layout.edges
    .map((placed) => {
      const edge = edges.get(placed.id);
      return edge ? renderEdge(edge, placed, nodes) : "";
    })
    .join("");
  const nodeMarkup = layout.nodes
    .map((placed) => {
      const node = nodes.get(placed.id);
      return node ? renderNode(node, placed, entries.has(node.id)) : "";
    })
    .join("");
  return `<g class="lt-edges">${edgeMarkup}</g><g class="lt-nodes">${nodeMarkup}</g>`;
}

function renderEdge(
  edge: LogicEdge,
  placed: LayoutEdge,
  nodes: ReadonlyMap<string, LogicNode>,
): string {
  const classes = ["lt-edge", `lt-edge--${edge.type}`];
  if (edge.branch) classes.push("lt-edge--branch");
  if (edge.source === "inferred") classes.push("lt-edge--inferred");
  const from = nodes.get(edge.from)?.label ?? edge.from;
  const to = nodes.get(edge.to)?.label ?? edge.to;
  const title = `${from} ${edge.type} ${to}${edge.source === "inferred" ? ` (inferred, ${Math.round(edge.confidence * 100)}%)` : ""}`;
  const label = placed.label
    ? `<g class="lt-edge__label" transform="translate(${placed.label.x},${placed.label.y})"><rect x="${-placed.label.width / 2}" y="${-placed.label.height / 2}" width="${placed.label.width}" height="${placed.label.height}" rx="4"/><text text-anchor="middle" y="3.5">${escapeXml(placed.label.text)}</text></g>`
    : "";
  return `<g class="${classes.join(" ")}" data-id="${escapeXml(edge.id)}" data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}"><title>${escapeXml(title)}</title><path class="lt-edge__path" d="${placed.path}"/>${label}</g>`;
}

function renderNode(node: LogicNode, placed: LayoutNode, entry: boolean): string {
  const { width: w, height: h } = placed;
  const text = nodeText(node);
  const classes = ["lt-node", `lt-node--${node.type}`];
  if (entry) classes.push("lt-node--entry");

  let shape: string;
  let chipX = 10;
  if (node.type === "condition") {
    const inset = 12;
    shape = `<polygon class="lt-node__box" points="${inset},0 ${w - inset},0 ${w},${h / 2} ${w - inset},${h} ${inset},${h} 0,${h / 2}"/>`;
    chipX = 16;
  } else {
    const radius = node.type === "error" || node.type === "response" ? Math.min(h / 2, 14) : 8;
    shape = `<rect class="lt-node__box" width="${w}" height="${h}" rx="${radius}"/>`;
  }
  const chipY = (h - 22) / 2;
  const chip = `<rect class="lt-node__chip" x="${chipX}" y="${chipY}" width="22" height="22" rx="6"/><path class="lt-node__icon" transform="translate(${chipX + 3},${chipY + 3})" d="${NODE_ICONS[node.type]}"/>`;
  const textX = chipX + 32;
  const labelY = text.meta ? h / 2 - 3 : h / 2 + 4.5;
  const label = `<text class="lt-node__label" x="${textX}" y="${labelY}">${escapeXml(text.label)}</text>`;
  const meta = text.meta
    ? `<text class="lt-node__meta" x="${textX}" y="${h / 2 + 13}">${escapeXml(text.meta)}</text>`
    : "";
  const title = `${node.label}${node.description ? `\n${node.description}` : ""}`;
  return `<g class="${classes.join(" ")}" data-id="${escapeXml(node.id)}" transform="translate(${round(placed.x - w / 2)},${round(placed.y - h / 2)})" tabindex="0" role="button" aria-label="${escapeXml(node.label)}"><title>${escapeXml(title)}</title>${shape}${chip}${label}${meta}</g>`;
}

export interface SvgDocumentOptions {
  theme?: Theme;
  layout?: GraphLayout;
}

/** A standalone SVG file with embedded styles and a title header. */
export function renderSvg(graph: LogicTrailGraph, options: SvgDocumentOptions = {}): string {
  const layout = options.layout ?? layoutGraph(graph);
  const width = Math.max(layout.width, 420);
  const height = layout.height + HEADER_HEIGHT;
  const theme = options.theme ?? "auto";
  const themeAttribute = theme === "auto" ? "" : ` data-theme="${theme}"`;
  const style = `${themeVariables(".lt-svg")}
.lt-svg {${FONT_VARIABLES}
}
${GRAPH_CSS}
.lt-svg__bg { fill: var(--lt-canvas); }
.lt-svg__title { font: 600 15px var(--lt-font-sans); fill: var(--lt-text); }
.lt-svg__subtitle { font: 400 11.5px var(--lt-font-mono); fill: var(--lt-text-muted); }
.lt-node { cursor: default; }`;
  const subtitle = `LogicTrail · ${graph.nodes.length} nodes · ${graph.edges.length} edges · ${graph.analysis.provider === "static" ? "static analysis" : (graph.analysis.model ?? graph.analysis.provider)}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="lt-svg"${themeAttribute} width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(graph.title)}">`,
    `<style>${style}</style>`,
    renderMarkers(),
    `<rect class="lt-svg__bg" width="100%" height="100%"/>`,
    `<text class="lt-svg__title" x="40" y="32">${escapeXml(graph.title)}</text>`,
    `<text class="lt-svg__subtitle" x="40" y="50">${escapeXml(subtitle)}</text>`,
    `<g transform="translate(0,${HEADER_HEIGHT})">${renderGraphMarkup(graph, layout)}</g>`,
    `</svg>`,
    "",
  ].join("\n");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
