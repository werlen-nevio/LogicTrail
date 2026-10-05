import type { LogicNode, LogicNodeType, LogicTrailGraph } from "../graph/model.js";

const CLASS_STYLES: Readonly<Record<LogicNodeType, string>> = {
  component: "fill:#f5f3ff,stroke:#7c3aed,color:#18181b",
  function: "fill:#ffffff,stroke:#71717a,color:#18181b",
  service: "fill:#f0fdfa,stroke:#0d9488,color:#18181b",
  route: "fill:#eff6ff,stroke:#2563eb,color:#18181b",
  database: "fill:#fff7ed,stroke:#c2410c,color:#18181b",
  external: "fill:#fdf2f8,stroke:#db2777,color:#18181b",
  library: "fill:#ecfeff,stroke:#0e7490,color:#18181b",
  condition: "fill:#fefce8,stroke:#a16207,color:#18181b",
  event: "fill:#fdf4ff,stroke:#a21caf,color:#18181b",
  error: "fill:#fef2f2,stroke:#dc2626,color:#7f1d1d",
  response: "fill:#f0fdf4,stroke:#15803d,color:#14532d",
};

export interface MermaidOptions {
  /** Include file:line under each label. Default true. */
  locations?: boolean;
  direction?: "TD" | "LR";
}

/** Renders the flow as a Mermaid flowchart (GitHub/GitLab/Notion compatible). */
export function renderMermaid(graph: LogicTrailGraph, options: MermaidOptions = {}): string {
  const showLocations = options.locations ?? true;
  const ids = new Map<string, string>();
  graph.nodes.forEach((node, index) => ids.set(node.id, `n${index + 1}`));

  const lines: string[] = [];
  lines.push(`%% LogicTrail: ${sanitizeComment(graph.query)}`);
  lines.push(`flowchart ${options.direction ?? "TD"}`);

  for (const node of graph.nodes) {
    const id = ids.get(node.id);
    if (!id) continue;
    const location =
      showLocations && node.file ? `${node.file}${node.line ? `:${node.line}` : ""}` : undefined;
    const label =
      location && node.type !== "condition"
        ? `${escapeLabel(node.label)}<br/><small>${escapeLabel(location)}</small>`
        : escapeLabel(node.label);
    lines.push(`  ${id}${shape(node, label)}`);
  }

  for (const edge of graph.edges) {
    const from = ids.get(edge.from);
    const to = ids.get(edge.to);
    if (!from || !to) continue;
    const inferred = edge.source === "inferred";
    let text = edge.label ?? "";
    if (inferred)
      text = `${text ? `${text} · ` : ""}inferred ${Math.round(edge.confidence * 100)}%`;
    const arrow =
      inferred || edge.type === "returns" ? "-.->" : edge.type === "requests" ? "==>" : "-->";
    lines.push(`  ${from} ${arrow}${text ? `|"${escapeLabel(text)}"|` : ""} ${to}`);
  }

  const used = new Set(graph.nodes.map((node) => node.type));
  for (const type of used) lines.push(`  classDef ${type} ${CLASS_STYLES[type]}`);
  for (const type of used) {
    const members = graph.nodes
      .filter((node) => node.type === type)
      .flatMap((node) => ids.get(node.id) ?? []);
    if (members.length > 0) lines.push(`  class ${members.join(",")} ${type}`);
  }
  return `${lines.join("\n")}\n`;
}

function shape(node: LogicNode, label: string): string {
  const quoted = `"${label}"`;
  switch (node.type) {
    case "condition":
      return `{${quoted}}`;
    case "database":
      return `[(${quoted})]`;
    case "route":
      return `[/${quoted}/]`;
    case "external":
      return `{{${quoted}}}`;
    case "event":
      return `>${quoted}]`;
    case "service":
      return `[[${quoted}]]`;
    case "error":
    case "response":
      return `([${quoted}])`;
    case "component":
    case "function":
    case "library":
      return `[${quoted}]`;
  }
}

/** Mermaid labels use HTML entities in `#code;` form for characters that break the syntax. */
export function escapeLabel(text: string): string {
  return text
    .replace(/&/g, "#amp;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\|/g, "#124;")
    .replace(/[\r\n]+/g, " ");
}

function sanitizeComment(text: string): string {
  return text.replace(/[\r\n]+/g, " ");
}
