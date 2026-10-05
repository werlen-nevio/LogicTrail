import fs from "node:fs/promises";
import path from "node:path";
import { OUTPUT_FORMATS, type OutputFormat, type ResolvedConfig } from "./config/config.js";
import { diffFlows, type FlowChanges } from "./flow/diff.js";
import { GRAPH_SCHEMA_VERSION, type FlowRequest, type LogicTrailGraph } from "./graph/model.js";
import type { LLMProvider } from "./llm/types.js";
import { EXTENSIONS, writeOutputs, type WrittenFile } from "./output.js";
import { analyze, type IndexedRepository } from "./pipeline.js";
import type { Theme } from "./render/svg.js";
import type { Reporter } from "./reporter.js";

/** A flow written earlier by LogicTrail. */
export interface SavedFlow {
  /** File name without extension, e.g. "how-does-checkout-work". */
  name: string;
  dir: string;
  /** The formats that were written for it, from the files present. */
  formats: OutputFormat[];
  graph: LogicTrailGraph;
  /** The theme of its SVG file, kept when the flow is updated. */
  theme: Theme;
}

export class SavedFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedFlowError";
  }
}

const FORMAT_OF = new Map(OUTPUT_FORMATS.map((format) => [`.${EXTENSIONS[format]}`, format]));

/**
 * Finds saved flows by name ("how-does-checkout-work") or file path, or every flow in `outDir`
 * when no names are given. Names that can't be loaded are returned as problems.
 */
export async function findSavedFlows(
  outDir: string,
  names: readonly string[] = [],
): Promise<{ flows: SavedFlow[]; problems: string[] }> {
  const wanted =
    names.length > 0
      ? names.map((name) => locate(outDir, name))
      : [...new Set((await listFiles(outDir)).flatMap((file) => flowName(file) ?? []))]
          .sort()
          .map((name) => ({ dir: outDir, name }));
  const flows: SavedFlow[] = [];
  const problems: string[] = [];
  for (const { dir, name } of wanted) {
    try {
      flows.push(await loadSavedFlow(dir, name));
    } catch (error) {
      if (!(error instanceof SavedFlowError)) throw error;
      problems.push(error.message);
    }
  }
  return { flows, problems };
}

/** Loads a saved flow from its .json file, or from the data embedded in its .html viewer. */
export async function loadSavedFlow(dir: string, name: string): Promise<SavedFlow> {
  const files = await listFiles(dir);
  const formats = OUTPUT_FORMATS.filter((format) =>
    files.includes(`${name}.${EXTENSIONS[format]}`),
  );
  const display = path.join(dir, name);
  if (formats.length === 0) throw new SavedFlowError(`No saved flow named "${name}" in ${dir}.`);

  let graph: unknown;
  try {
    if (formats.includes("json")) {
      graph = JSON.parse(await fs.readFile(`${display}.json`, "utf8"));
    } else if (formats.includes("html")) {
      const html = await fs.readFile(`${display}.html`, "utf8");
      const data =
        /<script id="logictrail-data" type="application\/json">([\s\S]*?)<\/script>/.exec(
          html,
        )?.[1];
      graph = data ? (JSON.parse(data) as { graph?: unknown }).graph : undefined;
    } else {
      throw new SavedFlowError(
        `${display} can't be updated: only .json and .html files record how a flow was made. Re-run the original command.`,
      );
    }
  } catch (error) {
    if (error instanceof SavedFlowError) throw error;
    throw new SavedFlowError(`Could not read ${display}: ${(error as Error).message}`);
  }
  if (!isGraph(graph)) throw new SavedFlowError(`${display} is not a LogicTrail flow.`);

  let theme: Theme = "auto";
  if (formats.includes("svg")) {
    const svg = await fs.readFile(`${display}.svg`, "utf8");
    const found = /^<svg[^>]*\sdata-theme="(\w+)"/m.exec(svg)?.[1];
    if (found === "light" || found === "dark") theme = found;
  }
  return { name, dir, formats, graph, theme };
}

export interface UpdateFlowOptions {
  root: string;
  config: ResolvedConfig;
  provider?: LLMProvider;
  reporter?: Reporter;
  /** Index the repository once with `indexAndAnalyze` when updating several flows. */
  indexed?: IndexedRepository;
  /** Override the limits the flow was made with. */
  maxDepth?: number;
  maxNodes?: number;
  /** Override the SVG theme the flow was written with. */
  theme?: Theme;
}

export interface UpdatedFlow {
  flow: SavedFlow;
  graph: LogicTrailGraph;
  changes: FlowChanges;
  written: WrittenFile[];
}

/**
 * Asks for a saved flow again with the same question or starting point and limits, against the
 * current code, and rewrites its files in the formats it had.
 */
export async function updateFlow(
  flow: SavedFlow,
  options: UpdateFlowOptions,
): Promise<UpdatedFlow> {
  // Flows written before `update` existed have no request: ask the question they show.
  const request: Partial<FlowRequest> = flow.graph.request ?? { question: flow.graph.query };
  const config: ResolvedConfig = {
    ...options.config,
    maxDepth: options.maxDepth ?? flow.graph.request?.maxDepth ?? options.config.maxDepth,
    maxNodes: options.maxNodes ?? flow.graph.request?.maxNodes ?? options.config.maxNodes,
  };
  const { graph } = await analyze({
    root: options.root,
    ...(request.question ? { question: request.question } : {}),
    target: {
      ...(request.file ? { file: request.file } : {}),
      ...(request.function ? { function: request.function } : {}),
      ...(request.route ? { route: request.route } : {}),
    },
    config,
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.reporter ? { reporter: options.reporter } : {}),
    ...(options.indexed ? { indexed: options.indexed } : {}),
  });
  const written = await writeOutputs(graph, {
    outDir: flow.dir,
    name: flow.name,
    formats: flow.formats,
    theme: options.theme ?? flow.theme,
  });
  return { flow, graph, changes: diffFlows(flow.graph, graph), written };
}

/** Where a name given on the command line points: a flow in `outDir`, or a flow file path. */
function locate(outDir: string, name: string): { dir: string; name: string } {
  const isPath = /[\\/]/.test(name) || FORMAT_OF.has(path.extname(name));
  if (!isPath) return { dir: outDir, name };
  const resolved = path.resolve(name);
  const ext = path.extname(resolved);
  return {
    dir: path.dirname(resolved),
    name: path.basename(resolved, FORMAT_OF.has(ext) ? ext : ""),
  };
}

function flowName(file: string): string | undefined {
  const ext = path.extname(file);
  return ext === ".json" || ext === ".html" ? path.basename(file, ext) : undefined;
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function isGraph(value: unknown): value is LogicTrailGraph {
  const graph = value as Partial<LogicTrailGraph> | undefined;
  return (
    typeof graph === "object" &&
    graph !== null &&
    graph.schemaVersion === GRAPH_SCHEMA_VERSION &&
    typeof graph.query === "string" &&
    Array.isArray(graph.nodes) &&
    Array.isArray(graph.edges)
  );
}
