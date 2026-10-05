import path from "node:path";
import { buildCodeGraph, type CodeGraph, type CodeNode } from "./analysis/code-graph.js";
import { Workspace } from "./analysis/workspace.js";
import { DEFAULT_CONFIG, type ResolvedConfig } from "./config/config.js";
import { buildFlowGraph } from "./flow/build.js";
import type { FlowRequest, LogicTrailGraph } from "./graph/model.js";
import { indexRepository, type IndexResult } from "./indexer/indexer.js";
import { selectProvider } from "./llm/index.js";
import { buildFlowAnalysisInput } from "./llm/input.js";
import { StaticProvider } from "./llm/static.js";
import { ProviderError, type FlowAnalysisResult, type LLMProvider } from "./llm/types.js";
import { validateSelection } from "./llm/validate.js";
import { chooseSeeds, extractCandidates, type CandidateGraph } from "./query/candidates.js";
import { RetrievalIndex } from "./query/retrieve.js";
import { queryTerms } from "./query/terms.js";
import { silentReporter, type Reporter } from "./reporter.js";
import { SourceReader } from "./source.js";

export interface FlowTarget {
  /** Repository-relative or absolute file path. */
  file?: string;
  /** Function, method or component name, e.g. "createSession" or "AuthService.login". */
  function?: string;
  /** Route path, optionally with a method: "/api/orders" or "POST /api/orders". */
  route?: string;
}

export interface AnalyzeOptions {
  /** Repository root. */
  root: string;
  question?: string;
  target?: FlowTarget;
  config?: ResolvedConfig;
  /** Overrides the provider chosen from config / environment. */
  provider?: LLMProvider;
  reporter?: Reporter;
  /** The repository from an earlier {@link indexAndAnalyze} call; skips indexing it again. */
  indexed?: IndexedRepository;
}

export interface AnalysisResult {
  graph: LogicTrailGraph;
  codeGraph: CodeGraph;
  candidates: CandidateGraph;
  index: IndexResult;
  provider: LLMProvider;
  usage?: { inputTokens: number; outputTokens: number };
}

export class NoFlowFoundError extends Error {
  constructor(
    message: string,
    readonly suggestions: string[] = [],
  ) {
    super(message);
    this.name = "NoFlowFoundError";
  }
}

/** The repository after indexing and static analysis, before any question is asked. */
export interface IndexedRepository {
  index: IndexResult;
  workspace: Workspace;
  codeGraph: CodeGraph;
}

export async function indexAndAnalyze(
  root: string,
  config: ResolvedConfig,
  reporter: Reporter,
): Promise<IndexedRepository> {
  reporter.phase("Indexing repository");
  const index = await indexRepository({
    root,
    ignore: config.ignore,
    cacheDir: config.cache ? path.resolve(root, config.cacheDir) : false,
    reporter,
  });
  for (const warning of index.warnings) reporter.debug(warning);
  if (index.files.length === 0) {
    throw new NoFlowFoundError(`No JavaScript or TypeScript files found in ${root}.`, [
      "Run LogicTrail from your project root or pass --root <dir>.",
      "Check your .gitignore and the ignore list in logictrail.config.ts.",
    ]);
  }
  const cached = index.stats.cached > 0 ? ` (${index.stats.cached} cached)` : "";
  reporter.success(`${formatCount(index.stats.files)} files${cached}`);

  const workspace = new Workspace(index.files, root);
  const codeGraph = buildCodeGraph(workspace);
  reporter.success(`${formatCount(index.stats.symbols)} symbols`);
  reporter.success(`${formatCount(codeGraph.edgeCount)} relationships`);
  return { index, workspace, codeGraph };
}

/**
 * The full pipeline: index -> code graph -> retrieval -> candidate sub-graph
 * -> semantic selection (LLM or static) -> validated flow graph.
 */
export async function analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
  const root = path.resolve(options.root);
  const config = options.config ?? DEFAULT_CONFIG;
  const reporter = options.reporter ?? silentReporter;
  let provider = options.provider;
  if (!provider) {
    const selection = selectProvider({
      model: config.llm.model,
      ...(config.llm.effort ? { effort: config.llm.effort } : {}),
      ...(config.llm.fallbacks !== undefined ? { fallbacks: config.llm.fallbacks } : {}),
    });
    provider = selection.provider;
    if (selection.notice) reporter.info(selection.notice);
  }

  const { index, codeGraph } = options.indexed ?? (await indexAndAnalyze(root, config, reporter));
  const question = options.question?.trim() || questionForTarget(options.target);
  reporter.phase(`Finding flow for:\n"${question}"`);

  const retrieval = new RetrievalIndex(codeGraph);
  const scored = retrieval.score(queryTerms(question));
  const scores = new Map(scored.map((node) => [node.id, node.score]));
  const usesLlm = !(provider instanceof StaticProvider);

  let seeds: string[];
  if (options.target && hasTarget(options.target)) {
    seeds = seedsForTarget(codeGraph, options.target, root);
    for (const seed of seeds)
      scores.set(seed, Math.max(scores.get(seed) ?? 0, scored[0]?.score ?? 1));
  } else {
    seeds = chooseSeeds(scored, usesLlm ? { limit: 30, ratio: 0.2 } : { limit: 12, ratio: 0.45 });
  }
  if (seeds.length === 0) {
    throw new NoFlowFoundError(`Could not find code related to "${question}".`, [
      'Try different words, e.g. names used in the code ("checkout", "createOrder").',
      "Target code directly with --function <name>, --file <path> or --route <path>.",
    ]);
  }
  reporter.debug(`Seeds: ${seeds.map((id) => codeGraph.nodes.get(id)?.label ?? id).join(", ")}`);

  const directMatches = new Set(
    scored.filter((node) => node.directScore > 0).map((node) => node.id),
  );
  for (const seed of seeds) directMatches.add(seed);
  const candidates = extractCandidates(
    codeGraph,
    scores,
    seeds,
    {
      maxDepth: config.maxDepth,
      maxCandidates: usesLlm ? Math.max(150, config.maxNodes * 2) : config.maxNodes,
      upDepth: 3,
    },
    directMatches,
  );
  reporter.success(`${formatCount(candidates.nodes.size)} relevant symbols`);

  const source = new SourceReader(root);
  const built = buildFlowAnalysisInput({
    question,
    repositoryName: path.basename(root),
    fileCount: index.stats.files,
    graph: codeGraph,
    candidates,
    source,
    maxNodes: config.maxNodes,
  });

  const warnings: string[] = [];
  let result: FlowAnalysisResult;
  let activeProvider = provider;
  const stop = usesLlm ? reporter.activity(`Asking ${provider.displayName}`) : () => undefined;
  try {
    result = await provider.analyzeFlow(built.input);
    stop();
  } catch (error) {
    stop();
    if (!(error instanceof ProviderError)) throw error;
    const message = `${error.message}${error.hint ? ` ${error.hint}` : ""}`;
    reporter.warn(`${message} Falling back to static analysis.`);
    warnings.push(
      `${provider.displayName} was unavailable (${error.message}); this flow comes from static analysis only.`,
    );
    activeProvider = new StaticProvider();
    result = await activeProvider.analyzeFlow(built.input);
  }
  if (usesLlm && activeProvider === provider) {
    const tokens = result.usage
      ? ` (${formatCount(result.usage.inputTokens + result.usage.outputTokens)} tokens)`
      : "";
    reporter.success(`${provider.displayName} selected ${result.nodes.length} nodes${tokens}`);
  }

  const selection = validateSelection(result, built.refs, candidates, config.maxNodes);
  for (const warning of selection.warnings) reporter.debug(warning);
  warnings.push(...selection.warnings);
  if (selection.nodes.length === 0) {
    throw new NoFlowFoundError(
      selection.explanation ?? `The repository does not seem to contain code for "${question}".`,
      [
        "Rephrase the question using names from the code, or target code with --function / --file / --route.",
      ],
    );
  }
  if (!selection.answerable) {
    warnings.push("The analysis suggests this flow is only partially present in the repository.");
  }

  const graph = buildFlowGraph({
    query: question,
    request: flowRequest(root, options, config),
    graph: codeGraph,
    candidates,
    selection: {
      title: selection.title,
      nodes: selection.nodes,
      entryPoints: selection.entryPoints,
      descriptions: selection.descriptions,
      inferredEdges: selection.inferredEdges,
      ...(selection.explanation ? { explanation: selection.explanation } : {}),
    },
    source,
    analysis: {
      provider: activeProvider.id,
      ...(activeProvider.model ? { model: activeProvider.model } : {}),
      generatedAt: new Date().toISOString(),
      repository: path.basename(root),
      rootPath: root,
      stats: {
        files: index.stats.files,
        symbols: index.stats.symbols,
        relationships: codeGraph.edgeCount,
        candidates: candidates.nodes.size,
      },
      warnings,
    },
  });
  reporter.success(`${formatCount(graph.nodes.length)} nodes`);
  reporter.success(`${formatCount(graph.edges.length)} edges`);

  return {
    graph,
    codeGraph,
    candidates,
    index,
    provider: activeProvider,
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

function hasTarget(target: FlowTarget): boolean {
  return Boolean(target.file || target.function || target.route);
}

/** What `logictrail update` needs to ask for the same flow again. */
function flowRequest(root: string, options: AnalyzeOptions, config: ResolvedConfig): FlowRequest {
  const { file, function: fn, route } = options.target ?? {};
  const question = options.question?.trim();
  const relativeFile =
    file && path.isAbsolute(file) ? path.relative(root, file).split(path.sep).join("/") : file;
  return {
    ...(question ? { question } : {}),
    ...(relativeFile ? { file: relativeFile } : {}),
    ...(fn ? { function: fn } : {}),
    ...(route ? { route } : {}),
    maxDepth: config.maxDepth,
    maxNodes: config.maxNodes,
  };
}

export function questionForTarget(target: FlowTarget | undefined): string {
  if (target?.function) return `What happens when ${target.function}() runs?`;
  if (target?.route) return `What happens when ${target.route} is called?`;
  if (target?.file) return `How does the code in ${target.file} work?`;
  return "How does this application work?";
}

/** Resolves --function / --file / --route to code graph nodes. */
export function seedsForTarget(graph: CodeGraph, target: FlowTarget, root: string): string[] {
  const nodes = [...graph.nodes.values()];
  const seeds = new Set<string>();

  if (target.function) {
    const wanted = target.function.replace(/\(\)$/, "").trim();
    const matches = (node: CodeNode, exact: boolean): boolean => {
      if (node.kind !== "symbol" || !node.symbol) return false;
      const names = [node.name, node.symbol.qualifiedName, node.label.replace(/\(\)$/, "")];
      return exact
        ? names.includes(wanted)
        : names.some((name) => name.toLowerCase() === wanted.toLowerCase());
    };
    let found = nodes.filter((node) => matches(node, true));
    if (found.length === 0) found = nodes.filter((node) => matches(node, false));
    if (found.length === 0) {
      const similar = nodes
        .filter(
          (node) =>
            node.kind === "symbol" && node.name.toLowerCase().includes(wanted.toLowerCase()),
        )
        .slice(0, 5)
        .map((node) => `${node.label} (${node.file}:${node.line})`);
      throw new NoFlowFoundError(
        `No function named "${wanted}" was found.`,
        similar.length > 0 ? similar.map((s) => `Did you mean ${s}?`) : [],
      );
    }
    for (const node of found) seeds.add(node.id);
  }

  if (target.file) {
    const relative = path.isAbsolute(target.file) ? path.relative(root, target.file) : target.file;
    const file = relative.split(path.sep).join("/").replace(/^\.\//, "");
    const inFile = nodes.filter(
      (node) =>
        node.file === file &&
        (node.kind === "route" || (node.symbol && node.symbol.scope !== "nested")),
    );
    if (inFile.length === 0) {
      throw new NoFlowFoundError(`No functions, components or routes found in ${file}.`, [
        "Paths are relative to the repository root, e.g. src/auth/login.ts.",
      ]);
    }
    const ids = new Set(inFile.map((node) => node.id));
    // Prefer the file's own entry points: symbols not called from elsewhere in the same file.
    const roots = inFile.filter((node) => !graph.in(node.id).some((edge) => ids.has(edge.from)));
    for (const node of roots.length > 0 ? roots : inFile) seeds.add(node.id);
  }

  if (target.route) {
    const match = /^\s*([A-Za-z]+)\s+(\S+)\s*$/.exec(target.route);
    const method = match?.[1]?.toUpperCase();
    const routePath = normalizeRoute(match?.[2] ?? target.route.trim());
    const routes = nodes.filter(
      (node) =>
        node.kind === "route" &&
        !node.metadata.navigation &&
        normalizeRoute(String(node.metadata.path)) === routePath &&
        (!method || node.metadata.method === method || node.metadata.method === "ANY"),
    );
    if (routes.length === 0) {
      const available = nodes
        .filter((node) => node.kind === "route" && !node.metadata.navigation)
        .slice(0, 8)
        .map((node) => node.label);
      throw new NoFlowFoundError(
        `No route matches "${target.route}".`,
        available.map((label) => `Available: ${label}`),
      );
    }
    for (const node of routes) seeds.add(node.id);
  }
  return [...seeds];
}

function normalizeRoute(route: string): string {
  const cleaned = `/${route.split(/[?#]/)[0] ?? ""}`.replace(/\/+/g, "/");
  const trimmed = cleaned.length > 1 ? cleaned.replace(/\/$/, "") : cleaned;
  return trimmed.replace(/\[(\w+)\]/g, ":$1").replace(/:\w+/g, ":param");
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
