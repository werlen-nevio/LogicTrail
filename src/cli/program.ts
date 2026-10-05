import path from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import pc from "picocolors";
import { OUTPUT_FORMATS, type OutputFormat, type ResolvedConfig } from "../config/config.js";
import { ConfigError, loadConfig } from "../config/load.js";
import { selectProvider } from "../llm/index.js";
import { ProviderError } from "../llm/types.js";
import { renderFormat, slugify, writeOutputs } from "../output.js";
import { analyze, NoFlowFoundError, type FlowTarget } from "../pipeline.js";
import type { Theme } from "../render/svg.js";
import { VERSION } from "../version.js";
import { openFile } from "./open.js";
import { TerminalReporter } from "./reporter.js";
import { displayPath, parsePositiveInt } from "./shared.js";
import { updateCommand } from "./update.js";

interface CliOptions {
  output?: OutputFormat[];
  open?: boolean;
  model?: string;
  maxDepth?: number;
  maxNodes?: number;
  file?: string;
  function?: string;
  route?: string;
  root: string;
  outDir?: string;
  name?: string;
  theme: Theme;
  config?: string;
  cache: boolean;
  stdout?: boolean;
  verbose?: boolean;
}

function parseFormats(value: string, previous: OutputFormat[] | undefined): OutputFormat[] {
  const formats = value
    .split(",")
    .map((format) => format.trim().toLowerCase())
    .filter(Boolean)
    .map((format) => (format === "md" || format === "mmd" ? "mermaid" : format));
  const all = formats.includes("all") ? [...OUTPUT_FORMATS] : formats;
  for (const format of all) {
    if (!(OUTPUT_FORMATS as readonly string[]).includes(format)) {
      throw new InvalidArgumentError(
        `Unknown format "${format}". Use ${OUTPUT_FORMATS.join(", ")} or all.`,
      );
    }
  }
  return [...new Set([...(previous ?? []), ...(all as OutputFormat[])])];
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("logictrail")
    .description(
      "Ask your codebase how it works. LogicTrail turns a question into an evidence-backed execution flow.",
    )
    .version(VERSION, "--version", "Show the version number")
    // Options after "update" belong to the update command, not to the question command.
    .enablePositionalOptions()
    .argument("[question...]", 'What to explain, e.g. "how does checkout work?"')
    .option(
      "-o, --output <formats>",
      `Output formats: ${OUTPUT_FORMATS.join(", ")} or all (comma-separated)`,
      parseFormats,
    )
    .option("--open", "Open the result in your browser")
    .option(
      "-m, --model <model>",
      'LLM to use: "claude", a Claude model id (e.g. claude-opus-5-5), or "static" for no LLM',
    )
    .option("--max-depth <n>", "How many hops to follow from the relevant code", parsePositiveInt)
    .option("--max-nodes <n>", "Maximum number of nodes in the flow", parsePositiveInt)
    .option("--file <path>", "Explain the flow starting in a file")
    .option("--function <name>", "Explain the flow starting at a function, method or component")
    .option("--route <route>", 'Explain the flow behind an HTTP route, e.g. "POST /api/orders"')
    .option("--root <dir>", "Repository root", ".")
    .option("--out-dir <dir>", "Where to write results (default: .logictrail)")
    .option("--name <name>", "Output file name without extension")
    .addOption(
      new Option("--theme <theme>", "SVG color theme")
        .choices(["auto", "light", "dark"])
        .default("auto"),
    )
    .option("--config <path>", "Path to a logictrail.config file")
    .option("--no-cache", "Re-analyze every file instead of reusing the cache")
    .option("--stdout", "Print the result to stdout instead of writing files (single format)")
    .option("-v, --verbose", "Show details about each step")
    .showHelpAfterError("(run logictrail --help for usage)")
    .addHelpText(
      "after",
      `
Examples:
  $ logictrail "how does checkout work?"
  $ logictrail "what happens after a user logs in?" --open
  $ logictrail --route "POST /api/orders" --output svg,mermaid
  $ logictrail --function createSession --model static
  $ logictrail "how does authentication work?" --output mermaid --stdout
  $ logictrail update                # re-run every saved flow against the current code

Environment:
  ANTHROPIC_API_KEY   Enables Claude for selection and explanations (static analysis otherwise)
  LOGICTRAIL_MODEL    Default for --model
`,
    )
    .action(async (words: string[], options: CliOptions) => {
      process.exitCode = await runCli(words.join(" "), options);
    });
  program.addCommand(updateCommand());
  return program;
}

async function runCli(question: string, options: CliOptions): Promise<number> {
  const reporter = new TerminalReporter(process.stderr, Boolean(options.verbose));
  reporter.header(VERSION);
  const root = path.resolve(options.root);
  const target: FlowTarget = {
    ...(options.file ? { file: options.file } : {}),
    ...(options.function ? { function: options.function } : {}),
    ...(options.route ? { route: options.route } : {}),
  };
  if (!question.trim() && !target.file && !target.function && !target.route) {
    reporter.error("Ask a question or pick a starting point.", [
      'logictrail "how does checkout work?"',
      "logictrail --function createSession",
      "Run logictrail --help for all options.",
    ]);
    return 2;
  }

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
  if (config.configFile) reporter.debug(`Config: ${path.relative(root, config.configFile)}`);
  const effective: ResolvedConfig = {
    ...config,
    maxDepth: options.maxDepth ?? config.maxDepth,
    maxNodes: options.maxNodes ?? config.maxNodes,
    cache: options.cache && config.cache,
    llm: {
      ...config.llm,
      model: options.model || process.env.LOGICTRAIL_MODEL || config.llm.model,
    },
  };
  const formats = options.output ?? effective.output;
  if (options.stdout && formats.length !== 1) {
    reporter.error("--stdout needs exactly one output format, e.g. --output mermaid --stdout.");
    return 2;
  }

  try {
    const selection = selectProvider({
      model: effective.llm.model,
      ...(effective.llm.effort ? { effort: effective.llm.effort } : {}),
      ...(effective.llm.fallbacks !== undefined ? { fallbacks: effective.llm.fallbacks } : {}),
    });
    if (selection.notice) reporter.info(selection.notice);
    const result = await analyze({
      root,
      ...(question.trim() ? { question } : {}),
      target,
      config: effective,
      provider: selection.provider,
      reporter,
    });

    if (options.stdout) {
      const [format] = formats;
      if (format)
        process.stdout.write(await renderFormat(result.graph, format, undefined, options.theme));
      return 0;
    }

    const outDir = path.resolve(root, options.outDir ?? effective.outputDir);
    const name = options.name ? slugify(options.name) : slugify(result.graph.query);
    const written = await writeOutputs(result.graph, {
      outDir,
      name,
      formats,
      theme: options.theme,
    });
    process.stderr.write(`\n${pc.bold("Generated:")}\n`);
    for (const file of written) process.stdout.write(`  ${displayPath(file.path)}\n`);

    if (options.open) {
      const preferred =
        written.find((file) => file.format === "html") ??
        written.find((file) => file.format === "svg") ??
        written[0];
      if (preferred) {
        try {
          await openFile(preferred.path);
        } catch (error) {
          reporter.warn(`Could not open ${preferred.path}: ${(error as Error).message}`);
        }
      }
    }
    return 0;
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
