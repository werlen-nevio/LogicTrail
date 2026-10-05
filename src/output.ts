import fs from "node:fs/promises";
import path from "node:path";
import type { OutputFormat } from "./config/config.js";
import type { LogicTrailGraph } from "./graph/model.js";
import { renderHtml } from "./render/html.js";
import { renderJson } from "./render/json.js";
import { layoutGraph } from "./render/layout.js";
import { renderMermaid } from "./render/mermaid.js";
import { renderSvg, type Theme } from "./render/svg.js";
import { VERSION } from "./version.js";

export const EXTENSIONS: Readonly<Record<OutputFormat, string>> = {
  html: "html",
  svg: "svg",
  mermaid: "mmd",
  json: "json",
};

export interface WriteOutputsOptions {
  outDir: string;
  /** File name without extension. */
  name: string;
  formats: readonly OutputFormat[];
  theme?: Theme;
}

export interface WrittenFile {
  format: OutputFormat;
  path: string;
}

/** Renders the graph in every requested format and writes the files. */
export async function writeOutputs(
  graph: LogicTrailGraph,
  options: WriteOutputsOptions,
): Promise<WrittenFile[]> {
  await fs.mkdir(options.outDir, { recursive: true });
  const needsLayout = options.formats.includes("html") || options.formats.includes("svg");
  const layout = needsLayout ? layoutGraph(graph) : undefined;
  const written: WrittenFile[] = [];
  for (const format of [...new Set(options.formats)]) {
    const content = await renderFormat(graph, format, layout, options.theme);
    const file = path.join(options.outDir, `${options.name}.${EXTENSIONS[format]}`);
    await fs.writeFile(file, content, "utf8");
    written.push({ format, path: file });
  }
  return written;
}

export async function renderFormat(
  graph: LogicTrailGraph,
  format: OutputFormat,
  layout = format === "html" || format === "svg" ? layoutGraph(graph) : undefined,
  theme: Theme = "auto",
): Promise<string> {
  switch (format) {
    case "html":
      return renderHtml(graph, { version: VERSION, ...(layout ? { layout } : {}) });
    case "svg":
      return renderSvg(graph, { theme, ...(layout ? { layout } : {}) });
    case "mermaid":
      return renderMermaid(graph);
    case "json":
      return renderJson(graph);
  }
}

/** "How does checkout work?" -> "how-does-checkout-work". */
export function slugify(text: string, max = 60): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = slug.length > max ? slug.slice(0, max).replace(/-[^-]*$/, "") : slug;
  return trimmed || "flow";
}
