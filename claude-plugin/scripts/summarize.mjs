#!/usr/bin/env node
// Prints a compact outline of a LogicTrail JSON graph: the steps in flow order with their file:line
// and the edges between them. The full JSON embeds source snippets and is too large to read whole.
// Usage: logictrail-outline <graph.json>   (the plugin's bin/ wrapper), or node summarize.mjs <graph.json>
import fs from "node:fs";

const MAX_DESCRIPTION = 220;

const file = process.argv[2];
if (!file) {
  console.error("Usage: logictrail-outline <graph.json>");
  process.exit(2);
}

/** @type {import("../../src/graph/model.js").LogicTrailGraph} */
const graph = JSON.parse(fs.readFileSync(file, "utf8"));
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

const { analysis } = graph;
const lines = [
  `# ${graph.title}`,
  `Question: ${graph.query}`,
  `Analysis: ${analysis.provider}${analysis.model ? ` (${analysis.model})` : ""} · ${graph.nodes.length} steps · ${graph.edges.length} edges · ${analysis.stats.files} files scanned`,
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
