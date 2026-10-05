import path from "node:path";
import { Command, Option } from "commander";
import pc from "picocolors";
import type { ResolvedConfig } from "../config/config.js";
import { ConfigError, loadConfig } from "../config/load.js";
import { hasChanges, location, type ChangedEdge, type FlowChanges } from "../flow/diff.js";
import type { LogicNode } from "../graph/model.js";
import { selectProvider } from "../llm/index.js";
import { ProviderError } from "../llm/types.js";
import { indexAndAnalyze, NoFlowFoundError } from "../pipeline.js";
import type { Theme } from "../render/svg.js";
import { findSavedFlows, updateFlow, type UpdatedFlow } from "../update.js";
import { VERSION } from "../version.js";
import { openFile } from "./open.js";
import { TerminalReporter } from "./reporter.js";
import { displayPath, parsePositiveInt } from "./shared.js";

/** Changed steps listed per kind before the rest is summarized. */
const MAX_LISTED = 12;

interface UpdateOptions {
  model?: string;
  maxDepth?: number;
  maxNodes?: number;
  root: string;
  outDir?: string;
  theme?: Theme;
  config?: string;
  cache: boolean;
  open?: boolean;
  verbose?: boolean;
}

export function updateCommand(): Command {
  return new Command("update")
    .description(
      "Re-run saved flows against the current code, with the question and options they were made with, and rewrite their files",
    )
    .argument(
      "[flows...]",
      "Flow names (e.g. how-does-checkout-work) or files; default: every flow in the output directory",
    )
    .option(
      "-m, --model <model>",
      'LLM to use: "claude", a Claude model id (e.g. claude-opus-5-5), or "static" for no LLM',
    )
    .option("--max-depth <n>", "Override the depth the flow was made with", parsePositiveInt)
    .option("--max-nodes <n>", "Override the node limit the flow was made with", parsePositiveInt)
    .option("--root <dir>", "Repository root", ".")
    .option("--out-dir <dir>", "Where the saved flows are (default: .logictrail)")
    .addOption(
      new Option("--theme <theme>", "SVG color theme (default: keep each flow's)").choices([
        "auto",
        "light",
        "dark",
      ]),
    )
    .option("--config <path>", "Path to a logictrail.config file")
    .option("--no-cache", "Re-analyze every file instead of reusing the cache")
    .option("--open", "Open the updated flow in your browser (one flow only)")
    .option("-v, --verbose", "Show details about each step")
    .addHelpText(
      "after",
      `
Examples:
  $ logictrail update
  $ logictrail update how-does-checkout-work
  $ logictrail update .logictrail/what-happens-when-a-payment-fails.html --model static
`,
    )
    .action(async (names: string[], options: UpdateOptions) => {
      process.exitCode = await runUpdate(names, options);
    });
}

async function runUpdate(names: string[], options: UpdateOptions): Promise<number> {
  const reporter = new TerminalReporter(process.stderr, Boolean(options.verbose));
  reporter.header(VERSION);
  const root = path.resolve(options.root);

  let config: ResolvedConfig;
  try {
    config = await loadConfig(root, options.config);
  } catch (error) {
    if (error instanceof ConfigError) {
      reporter.error(error.message);
      return 1;
    }
    throw error;
  }
  const effective: ResolvedConfig = {
    ...config,
    cache: options.cache && config.cache,
    llm: {
      ...config.llm,
      model: options.model || process.env.LOGICTRAIL_MODEL || config.llm.model,
    },
  };

  const outDir = path.resolve(root, options.outDir ?? effective.outputDir);
  const { flows, problems } = await findSavedFlows(outDir, names);
  if (flows.length === 0) {
    const hints =
      names.length > 0
        ? ['To ask a question that starts with "update", quote it: logictrail "update …"']
        : ['Create one first, e.g. logictrail "how does checkout work?"'];
    reporter.error(problems[0] ?? `No saved flows in ${displayPath(outDir)}.`, [
      ...problems.slice(1),
      ...hints,
    ]);
    return 1;
  }
  for (const problem of problems) reporter.warn(problem);

  try {
    const selection = selectProvider({
      model: effective.llm.model,
      ...(effective.llm.effort ? { effort: effective.llm.effort } : {}),
      ...(effective.llm.fallbacks !== undefined ? { fallbacks: effective.llm.fallbacks } : {}),
    });
    if (selection.notice) reporter.info(selection.notice);
    const indexed = await indexAndAnalyze(root, effective, reporter);

    const updated: UpdatedFlow[] = [];
    let failed = problems.length;
    for (const flow of flows) {
      try {
        const result = await updateFlow(flow, {
          root,
          config: effective,
          provider: selection.provider,
          reporter,
          indexed,
          ...(options.maxDepth ? { maxDepth: options.maxDepth } : {}),
          ...(options.maxNodes ? { maxNodes: options.maxNodes } : {}),
          ...(options.theme ? { theme: options.theme } : {}),
        });
        reportChanges(reporter, result);
        updated.push(result);
      } catch (error) {
        if (!(error instanceof NoFlowFoundError)) throw error;
        reporter.error(`${flow.name}: ${error.message}`, error.suggestions);
        failed++;
      }
    }

    if (updated.length > 0) {
      process.stderr.write(`\n${pc.bold("Updated:")}\n`);
      for (const file of updated.flatMap((result) => result.written)) {
        process.stdout.write(`  ${displayPath(file.path)}\n`);
      }
    }
    if (options.open) await openUpdated(reporter, updated);
    return failed > 0 ? 1 : 0;
  } catch (error) {
    if (error instanceof NoFlowFoundError) {
      reporter.error(error.message, error.suggestions);
      return 1;
    }
    if (error instanceof ProviderError) {
      reporter.error(error.message, error.hint ? [error.hint] : []);
      return 1;
    }
    throw error;
  }
}

function reportChanges(reporter: TerminalReporter, { flow, changes }: UpdatedFlow): void {
  if (!hasChanges(changes)) {
    reporter.success(`${flow.name}: no changes`);
    return;
  }
  reporter.success(`${flow.name}: ${summarize(changes)}`);
  const lines = [
    ...listed(
      changes.added.map((node) => `${pc.green("+")} ${describe(node)}`),
      "added",
    ),
    ...listed(
      changes.removed.map((node) => `${pc.red("−")} ${describe(node)}`),
      "removed",
    ),
    ...listed(
      changes.moved.map(
        ({ node, from }) =>
          `${pc.yellow("~")} ${node.label}  ${pc.dim(`${from} → ${movedTo(from, location(node))}`)}`,
      ),
      "moved",
    ),
    // Connections gained or lost between steps that are in both versions. Edges to added or
    // removed steps follow from the lines above.
    ...listed(
      [
        ...changes.addedEdges
          .filter((change) => change.betweenKeptSteps)
          .map((change) => `${pc.green("+")} ${connection(change)}`),
        ...changes.removedEdges
          .filter((change) => change.betweenKeptSteps)
          .map((change) => `${pc.red("−")} ${connection(change)}`),
      ],
      "connections",
    ),
  ];
  for (const line of lines) process.stderr.write(`  ${line}\n`);
}

function connection({ edge, from, to }: ChangedEdge): string {
  const notes = [edge.type, edge.branch ?? edge.label].filter(Boolean).join(", ");
  return `${from.label} → ${to.label} ${pc.dim(`(${notes})`)}`;
}

function summarize(changes: FlowChanges): string {
  const count = (n: number, what: string): string[] => (n > 0 ? [`${n} ${what}`] : []);
  const steps = [
    ...count(changes.added.length, "added"),
    ...count(changes.removed.length, "removed"),
    ...count(changes.moved.length, "moved"),
  ];
  const edges = [
    ...count(changes.addedEdges.length, "added"),
    ...count(changes.removedEdges.length, "removed"),
  ];
  return [
    ...(steps.length > 0 ? [`steps ${steps.join(", ")}`] : []),
    ...(edges.length > 0 ? [`edges ${edges.join(", ")}`] : []),
  ].join("; ");
}

function listed(lines: string[], kind: string): string[] {
  if (lines.length <= MAX_LISTED) return lines;
  return [...lines.slice(0, MAX_LISTED), pc.dim(`… and ${lines.length - MAX_LISTED} more ${kind}`)];
}

function describe(node: LogicNode): string {
  const where = location(node);
  return `${node.label} ${pc.dim(`(${node.type})${where ? ` ${where}` : ""}`)}`;
}

/** "a.ts:12" -> "a.ts:15" reads as ":15"; a move to another file shows the full location. */
function movedTo(from: string, to: string): string {
  const line = /:(\d+)$/.exec(to)?.[1];
  const file = (where: string): string => where.replace(/:\d+$/, "");
  return line && file(from) === file(to) ? `:${line}` : to;
}

async function openUpdated(reporter: TerminalReporter, updated: UpdatedFlow[]): Promise<void> {
  if (updated.length !== 1) {
    if (updated.length > 1) reporter.warn("--open works with a single flow; pass its name.");
    return;
  }
  const written = updated[0]?.written ?? [];
  const preferred =
    written.find((file) => file.format === "html") ??
    written.find((file) => file.format === "svg") ??
    written[0];
  if (!preferred) return;
  try {
    await openFile(preferred.path);
  } catch (error) {
    reporter.warn(`Could not open ${preferred.path}: ${(error as Error).message}`);
  }
}
