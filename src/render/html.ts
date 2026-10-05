import type { LogicTrailGraph } from "../graph/model.js";
import { loadViewerAssets } from "./assets.js";
import { layoutGraph } from "./layout.js";
import type { GraphLayout } from "./layout-types.js";
import { escapeXml, renderGraphMarkup, renderMarkers } from "./svg.js";
import { FONT_VARIABLES, GRAPH_CSS, NODE_TYPE_LABELS, themeVariables } from "./theme.js";

export interface HtmlOptions {
  layout?: GraphLayout;
  version: string;
}

/** The small-size cut of the logo (docs/brand/logo/logictrail-icon-small.svg), drawn on a 16 px grid. */
const LOGO_MARK = `<rect width="16" height="16" rx="3.5" fill="#ffc400"/><path fill="#16171b" d="M3 9a2 2 0 0 1 4 0v3a2 2 0 0 1-4 0Zm6-5a2 2 0 0 1 4 0v3a2 2 0 0 1-4 0Z"/>`;

export const LOGO_SVG = `<svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">${LOGO_MARK}</svg>`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${LOGO_MARK}</svg>`;

const ICONS = {
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z M10.6 10.6 14 14",
  zoomOut: "M3.5 8h9",
  zoomIn: "M8 3.5v9M3.5 8h9",
  fit: "M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10",
  theme: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z M8 2.5v11 M8 5h3 M8 8h4.5 M8 11h3",
  panel: "M3 3h10a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 3 3Z M10 3v10",
};

function strokeIcon(path: string): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

function button(id: string, title: string, icon: string, extra = ""): string {
  return `<button class="icon-button" type="button" id="${id}" title="${escapeXml(title)}" aria-label="${escapeXml(title)}"${extra}>${strokeIcon(icon)}</button>`;
}

/** Embeds JSON in a <script> block without allowing it to close the tag. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * A single self-contained HTML file: styles, data, the pre-rendered graph and
 * the viewer script are all inline, so it works offline from file://.
 */
export async function renderHtml(graph: LogicTrailGraph, options: HtmlOptions): Promise<string> {
  const layout = options.layout ?? layoutGraph(graph);
  const assets = await loadViewerAssets();
  const css = [themeVariables(":root"), `:root {${FONT_VARIABLES}\n}`, GRAPH_CSS, assets.css].join(
    "\n",
  );
  const data = safeJson({ graph, layout, version: options.version });
  const provider =
    graph.analysis.provider === "static"
      ? "static analysis"
      : (graph.analysis.model ?? graph.analysis.provider);
  const types = [...new Set(graph.nodes.map((node) => node.type))];
  const legend = [
    ...types.map(
      (type) =>
        `<span class="legend__item"><span class="legend__swatch" style="--swatch: var(--lt-c-${type})"></span>${escapeXml(NODE_TYPE_LABELS[type])}</span>`,
    ),
    graph.edges.some((edge) => edge.source === "inferred")
      ? `<span class="legend__item"><span class="legend__line"></span>Inferred</span>`
      : "",
  ].join("");
  const script = assets.script.replace(/<\/script/gi, "<\\/script");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="LogicTrail ${escapeXml(options.version)}">
<meta name="color-scheme" content="light dark">
<title>${escapeXml(graph.title)} · LogicTrail</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}">
<style>
${css}
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">${LOGO_SVG}<span>LogicTrail</span></div>
    <div class="divider"></div>
    <div class="query">
      <span class="query__text" title="${escapeXml(graph.query)}">${escapeXml(graph.title)}</span>
      <span class="query__meta">${graph.nodes.length} nodes · ${graph.edges.length} edges · ${escapeXml(provider)}</span>
    </div>
    <div class="search" role="search">
      <span class="search__icon">${strokeIcon(ICONS.search)}</span>
      <input id="search" type="search" placeholder="Search nodes" autocomplete="off" spellcheck="false" aria-label="Search nodes" aria-controls="search-results">
      <kbd>/</kbd>
      <div class="search__results" id="search-results" role="listbox" hidden></div>
    </div>
    <div class="toolbar">
      ${button("zoom-out", "Zoom out (−)", ICONS.zoomOut)}
      ${button("zoom-in", "Zoom in (+)", ICONS.zoomIn)}
      ${button("fit", "Fit to screen (F)", ICONS.fit)}
      ${button("theme", "Toggle theme (T)", ICONS.theme)}
      ${button("panel-toggle", "Toggle details panel", ICONS.panel, ' aria-pressed="true"')}
    </div>
  </header>
  <main class="workspace">
    <div class="canvas" id="canvas">
      <svg id="graph" role="group" aria-label="${escapeXml(graph.title)}">${renderMarkers()}<g id="viewport">${renderGraphMarkup(graph, layout)}</g></svg>
      <div class="legend" aria-label="Legend">${legend}</div>
      <div class="zoom-indicator" id="zoom-indicator">100%</div>
    </div>
    <aside class="panel" id="panel" aria-label="Details"></aside>
  </main>
</div>
<noscript><p style="padding:16px">Enable JavaScript to explore this LogicTrail flow interactively.</p></noscript>
<script id="logictrail-data" type="application/json">${data}</script>
<script>${script}</script>
</body>
</html>
`;
}
