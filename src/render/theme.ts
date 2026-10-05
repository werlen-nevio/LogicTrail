import type { LogicNodeType } from "../graph/model.js";

/** 16x16 stroke icons per node type. */
export const NODE_ICONS: Readonly<Record<LogicNodeType, string>> = {
  component: "M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4",
  function: "M10.5 2.5c-1.7 0-2.4.9-2.7 2.6L6.6 11c-.3 1.7-1 2.5-2.6 2.5M5 7h5.5",
  service: "M8 2 14 5 8 8 2 5Z M2 8.2l6 3 6-3 M2 11l6 3 6-3",
  route: "M2.5 8h10M9.5 4.5 13 8l-3.5 3.5",
  database:
    "M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2Z M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4 M3 8c0 1.1 2.2 2 5 2s5-.9 5-2",
  external:
    "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Z M2 8h12 M8 2c1.7 1.8 2.5 3.8 2.5 6S9.7 12.2 8 14 M8 2C6.3 3.8 5.5 5.8 5.5 8s.8 4.2 2.5 6",
  library: "M2.5 5 8 2l5.5 3v6L8 14l-5.5-3Z M2.5 5 8 8l5.5-3 M8 8v6",
  condition: "M8 2 14 8 8 14 2 8Z",
  event: "M9 1.5 3.5 9H8l-1 5.5L12.5 7H8Z",
  error: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Z M8 5v3.5 M8 11h.01",
  response: "M13 4.5 6.5 11 3 7.5",
};

export const NODE_TYPE_LABELS: Readonly<Record<LogicNodeType, string>> = {
  component: "Component",
  function: "Function",
  service: "Service",
  route: "Route",
  database: "Database",
  external: "External service",
  library: "Library",
  condition: "Condition",
  event: "Event / queue",
  error: "Error",
  response: "Response",
};

const LIGHT = `
  --lt-bg: #ffffff;
  --lt-canvas: #fafafa;
  --lt-dot: #e4e4e7;
  --lt-node-bg: #ffffff;
  --lt-node-border: #e4e4e7;
  --lt-node-border-hover: #a1a1aa;
  --lt-text: #18181b;
  --lt-text-muted: #71717a;
  --lt-edge: #a1a1aa;
  --lt-edge-strong: #52525b;
  --lt-label-bg: #ffffff;
  --lt-accent: #2563eb;
  --lt-panel: #ffffff;
  --lt-border: #e4e4e7;
  --lt-hover: #f4f4f5;
  --lt-subtle: #f6f6f7;
  --lt-shadow: 0 1px 2px rgba(0, 0, 0, .04), 0 8px 24px rgba(0, 0, 0, .06);
  --lt-error-bg: #fef2f2;
  --lt-error-border: #fecaca;
  --lt-response-bg: #f0fdf4;
  --lt-response-border: #bbf7d0;
  --lt-c-component: #7c3aed;
  --lt-c-function: #52525b;
  --lt-c-service: #0d9488;
  --lt-c-route: #2563eb;
  --lt-c-database: #c2410c;
  --lt-c-external: #db2777;
  --lt-c-library: #0e7490;
  --lt-c-condition: #a16207;
  --lt-c-event: #a21caf;
  --lt-c-error: #dc2626;
  --lt-c-response: #15803d;`;

const DARK = `
  --lt-bg: #0b0b0c;
  --lt-canvas: #0b0b0c;
  --lt-dot: #1f1f23;
  --lt-node-bg: #141416;
  --lt-node-border: #2a2a2e;
  --lt-node-border-hover: #52525b;
  --lt-text: #f4f4f5;
  --lt-text-muted: #a1a1aa;
  --lt-edge: #4b4b52;
  --lt-edge-strong: #a1a1aa;
  --lt-label-bg: #141416;
  --lt-accent: #60a5fa;
  --lt-panel: #101012;
  --lt-border: #232327;
  --lt-hover: #1c1c20;
  --lt-subtle: #17171a;
  --lt-shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 8px 24px rgba(0, 0, 0, .35);
  --lt-error-bg: #2a1215;
  --lt-error-border: #5c2127;
  --lt-response-bg: #0f2418;
  --lt-response-border: #1d4d2e;
  --lt-c-component: #a78bfa;
  --lt-c-function: #a1a1aa;
  --lt-c-service: #2dd4bf;
  --lt-c-route: #60a5fa;
  --lt-c-database: #fb923c;
  --lt-c-external: #f472b6;
  --lt-c-library: #22d3ee;
  --lt-c-condition: #facc15;
  --lt-c-event: #e879f9;
  --lt-c-error: #f87171;
  --lt-c-response: #4ade80;`;

/**
 * Theme variables. `scope` is the selector that owns the light palette; the
 * dark palette applies via prefers-color-scheme unless data-theme="light"
 * forces light, and data-theme="dark" forces dark.
 */
export function themeVariables(scope: string): string {
  return `${scope} {${LIGHT}
}
@media (prefers-color-scheme: dark) {
  ${scope}:not([data-theme="light"]) {${DARK}
  }
}
${scope}[data-theme="dark"] {${DARK}
}`;
}

/** Styles for graph elements, shared by the standalone SVG and the HTML viewer. */
export const GRAPH_CSS = `
.lt-node { cursor: pointer; }
.lt-node__box { fill: var(--lt-node-bg); stroke: var(--lt-node-border); stroke-width: 1; transition: stroke .12s ease; }
.lt-node:hover .lt-node__box { stroke: var(--lt-node-border-hover); }
.lt-node__chip { fill: var(--lt-type); fill-opacity: .1; }
.lt-node__icon { fill: none; stroke: var(--lt-type); stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.lt-node__label { font: 600 12.5px var(--lt-font-mono); fill: var(--lt-text); }
.lt-node__meta { font: 400 11px var(--lt-font-mono); fill: var(--lt-text-muted); }
.lt-node--component { --lt-type: var(--lt-c-component); }
.lt-node--function { --lt-type: var(--lt-c-function); }
.lt-node--service { --lt-type: var(--lt-c-service); }
.lt-node--route { --lt-type: var(--lt-c-route); }
.lt-node--database { --lt-type: var(--lt-c-database); }
.lt-node--external { --lt-type: var(--lt-c-external); }
.lt-node--library { --lt-type: var(--lt-c-library); }
.lt-node--condition { --lt-type: var(--lt-c-condition); }
.lt-node--event { --lt-type: var(--lt-c-event); }
.lt-node--error { --lt-type: var(--lt-c-error); }
.lt-node--response { --lt-type: var(--lt-c-response); }
.lt-node--condition .lt-node__box { stroke: var(--lt-c-condition); stroke-opacity: .55; stroke-dasharray: 4 3; }
.lt-node--error .lt-node__box { fill: var(--lt-error-bg); stroke: var(--lt-error-border); }
.lt-node--response .lt-node__box { fill: var(--lt-response-bg); stroke: var(--lt-response-border); }
.lt-node--entry .lt-node__box { stroke: var(--lt-type); stroke-width: 1.5; }
.lt-edge__path { fill: none; stroke: var(--lt-edge); stroke-width: 1.4; marker-end: url(#lt-arrow); }
.lt-edge--reads .lt-edge__path, .lt-edge--writes .lt-edge__path { stroke: var(--lt-c-database); stroke-opacity: .55; marker-end: url(#lt-arrow-database); }
.lt-edge--requests .lt-edge__path { stroke: var(--lt-c-route); stroke-opacity: .6; marker-end: url(#lt-arrow-route); }
.lt-edge--emits .lt-edge__path, .lt-edge--triggers .lt-edge__path { stroke: var(--lt-c-event); stroke-opacity: .55; marker-end: url(#lt-arrow-event); }
.lt-edge--returns .lt-edge__path { stroke-dasharray: 2 3; }
.lt-edge--inferred .lt-edge__path { stroke-dasharray: 6 4; }
.lt-edge__label rect { fill: var(--lt-label-bg); stroke: var(--lt-node-border); }
.lt-edge__label text { font: 500 10.5px var(--lt-font-mono); fill: var(--lt-text-muted); }
.lt-edge--branch .lt-edge__label text { fill: var(--lt-c-condition); }
.lt-edge--inferred .lt-edge__label text { font-style: italic; }
.lt-arrow { fill: var(--lt-edge); }
.lt-arrow--database { fill: var(--lt-c-database); }
.lt-arrow--route { fill: var(--lt-c-route); }
.lt-arrow--event { fill: var(--lt-c-event); }
.lt-arrow--accent { fill: var(--lt-accent); }
`;

export const FONT_VARIABLES = `
  --lt-font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --lt-font-mono: ui-monospace, SFMono-Regular, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace;`;
