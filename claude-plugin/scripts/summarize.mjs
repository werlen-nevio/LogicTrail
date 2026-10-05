#!/usr/bin/env node
// Prints a compact outline of a LogicTrail flow: the steps in flow order with their file:line and
// the edges between them. The full graph embeds source snippets and is too large to read whole.
// Reads a flow's .json file or the data embedded in its .html viewer.
// Usage: logictrail-outline <flow.json|flow.html>   (the plugin's bin/ wrapper), or node summarize.mjs
import fs from "node:fs";

const MAX_DESCRIPTION = 220;

const file = process.argv[2];
if (!file) {
  console.error("Usage: logictrail-outline <flow.json|flow.html>");
  process.exit(2);
}

const text = fs.readFileSync(file, "utf8");
const embedded = /<script id="logictrail-data" type="application\/json">([\s\S]*?)<\/script>/.exec(
  text,
)?.[1];
/** @type {import("../../src/graph/model.js").LogicTrailGraph | undefined} */
let graph;
try {
  graph = file.endsWith(".html") ? embedded && JSON.parse(embedded).graph : JSON.parse(text);
} catch {
  graph = undefined;
}
if (!graph?.nodes) {
  console.error(`${file} is not a LogicTrail flow.`);
  process.exit(1);
}
const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
const outgoing = new Map();
for (const edge of graph.edges) {
  if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
  outgoing.get(edge.from).push(edge);
}

// Flow order: breadth-first from the entry points (as the viewer reads it), then anything unreached.
const order = [];
const seen = new Set();
const queue = [...graph.entryPoints];
while (queue.length > 0) {
  const id = queue.shift();
  if (seen.has(id) || !nodes.has(id)) continue;
  seen.add(id);
  order.push(nodes.get(id));
  for (const edge of outgoing.get(id) ?? []) queue.push(edge.to);
}
for (const node of graph.nodes) if (!seen.has(node.id)) order.push(node);
const step = new Map(order.map((node, index) => [node.id, index + 1]));

const where = (node) =>
  node.file ? `${node.file}${node.line ? `:${node.line}` : ""}` : "no source";
const shorten = (text) =>
  text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : text;

const { analysis, request } = graph;
const start = ["file", "function", "route"]
  .filter((key) => request?.[key])
  .map((key) => `--${key} ${request[key]}`);
const lines = [
  `# ${graph.title}`,
  `Question: ${graph.query}`,
  ...(start.length > 0 ? [`Starting point: ${start.join(" ")}`] : []),
  `Analysis: ${analysis.provider}${analysis.model ? ` (${analysis.model})` : ""} · ${graph.nodes.length} steps · ${graph.edges.length} edges · ${analysis.stats.files} files scanned · generated ${analysis.generatedAt}`,
  `Entry points: ${graph.entryPoints.map((id) => `[${step.get(id)}]`).join(", ") || "none"}`,
  "",
  "## Explanation",
  graph.explanation.trim() || "(none)",
  "",
  "## Steps",
];
for (const node of order) {
  lines.push(`[${step.get(node.id)}] ${node.type} ${node.label} — ${where(node)}`);
  if (node.description) lines.push(`    ${shorten(node.description.replace(/\s+/g, " "))}`);
  for (const edge of outgoing.get(node.id) ?? []) {
    const target = nodes.get(edge.to);
    if (!target) continue;
    const notes = [edge.type];
    if (edge.label) notes.push(edge.label);
    if (edge.branch && edge.branch !== edge.label) notes.push(`branch: ${edge.branch}`);
    if (edge.source === "inferred") {
      notes.push(
        `inferred ${Math.round(edge.confidence * 100)}%${edge.reason ? `: ${edge.reason}` : ""}`,
      );
    }
    lines.push(`    → [${step.get(edge.to)}] ${target.label} (${notes.join(" · ")})`);
  }
}
if (analysis.warnings.length > 0) {
  lines.push("", "## Warnings", ...analysis.warnings.map((warning) => `- ${warning}`));
}
console.log(lines.join("\n"));
