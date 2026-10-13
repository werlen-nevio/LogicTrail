import path from "node:path";
import { buildCodeGraph, type CodeGraph, type CodeNode } from "./analysis/code-graph.js";
import { Workspace } from "./analysis/workspace.js";
import { DEFAULT_CONFIG, type ResolvedConfig } from "./config/config.js";
import { buildFlowGraph } from "./flow/build.js";
import type { FlowRequest, LogicTrailGraph } from "./graph/model.js";
import { indexRepository, type IndexResult } from "./indexer/indexer.js";
import { selectProvider } from "./llm/index.js";
import { buildFlowAnalysisInput } from "./llm/input.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./llm/prompt.js";
import { StaticProvider } from "./llm/static.js";
import {
  ProviderError,
  type FlowAnalysisInput,
  type FlowAnalysisResult,
  type LLMProvider,
} from "./llm/types.js";
import { validateSelection } from "./llm/validate.js";
import {
  chooseSeeds,
  extractCandidates,
  isTestFile,
  mentionsTests,
  type CandidateGraph,
} from "./query/candidates.js";
import { RetrievalIndex } from "./query/retrieve.js";
import { queryTerms } from "./query/terms.js";
import { silentReporter, type Reporter } from "./reporter.js";
import { SourceReader } from "./source.js";
import { asText, editDistance } from "./util/text.js";

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

  const usesLlm = !(provider instanceof StaticProvider);
  const { question, index, codeGraph, candidates, source, built } = await prepareFlow(
    options,
    usesLlm,
  );

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

  const warningsBeforeBuild = warnings.length;
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
    maxNodes: config.maxNodes,
    analysis: {
      provider: activeProvider.id,
      ...(activeProvider.model ? { model: activeProvider.model } : {}),
      generatedAt: new Date().toISOString(),
      repository: path.basename(root),
      stats: {
        files: index.stats.files,
        symbols: index.stats.symbols,
        relationships: codeGraph.edgeCount,
        candidates: candidates.nodes.size,
      },
      warnings,
    },
  });
  for (const warning of graph.analysis.warnings.slice(warningsBeforeBuild)) reporter.warn(warning);
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

/** What would be sent to Claude for a question, without sending it. */
export interface FlowPrompt {
  system: string;
  user: string;
  input: FlowAnalysisInput;
}

/**
 * Builds the prompt {@link analyze} sends to Claude, using the same retrieval and candidate
 * limits, but calls no provider. Works without an API key.
 */
export async function buildFlowPrompt(options: AnalyzeOptions): Promise<FlowPrompt> {
  const { built } = await prepareFlow(options, true);
  return { system: SYSTEM_PROMPT, user: buildUserPrompt(built.input), input: built.input };
}

/** Index -> code graph -> retrieval -> candidate sub-graph -> the provider's input. */
async function prepareFlow(options: AnalyzeOptions, usesLlm: boolean) {
  const root = path.resolve(options.root);
  const config = options.config ?? DEFAULT_CONFIG;
  const reporter = options.reporter ?? silentReporter;
  const { index, codeGraph } = options.indexed ?? (await indexAndAnalyze(root, config, reporter));
  const question = options.question?.trim() || questionForTarget(options.target);
  reporter.phase(`Finding flow for:\n"${question}"`);

  const retrieval = new RetrievalIndex(codeGraph);
  const scored = retrieval.score(queryTerms(question));
  const scores = new Map(scored.map((node) => [node.id, node.score]));

  let seeds: string[];
  if (options.target && hasTarget(options.target)) {
    seeds = seedsForTarget(codeGraph, options.target, root);
    for (const seed of seeds)
      scores.set(seed, Math.max(scores.get(seed) ?? 0, scored[0]?.score ?? 1));
  } else {
    seeds = chooseSeeds(codeGraph, scored, {
      ...(usesLlm ? { limit: 30, ratio: 0.2, perFile: 5 } : { limit: 12, ratio: 0.45 }),
      maxDepth: config.maxDepth,
      tests: mentionsTests(question) ? "include" : "avoid",
    });
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
  // Tests, mocks and fixtures stay out of the flow unless it is about them.
  const testFile = (id: string): boolean => isTestFile(codeGraph.nodes.get(id)?.file);
  const includeTests = mentionsTests(question) || seeds.some(testFile);
  const candidates = extractCandidates(
    codeGraph,
    scores,
    seeds,
    {
      maxDepth: config.maxDepth,
      ...(includeTests ? {} : { exclude: testFile }),
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
  return { question, index, codeGraph, candidates, source, built };
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
  if (target?.function) {
    const separator = target.function.lastIndexOf("#");
    if (separator > 0) {
      const name = target.function.slice(separator + 1).replace(/\(\)$/, "");
      return `What happens when ${name}() in ${target.function.slice(0, separator)} runs?`;
    }
    return `What happens when ${target.function.replace(/\(\)$/, "")}() runs?`;
  }
  if (target?.route) return `What happens when ${target.route} is called?`;
  if (target?.file) return `How does the code in ${target.file} work?`;
  return "How does this application work?";
}

/** Resolves --function / --file / --route to code graph nodes. */
export function seedsForTarget(graph: CodeGraph, target: FlowTarget, root: string): string[] {
  const nodes = [...graph.nodes.values()];
  const seeds = new Set<string>();

  if (target.function) {
    // `path/to/file.ts#name` picks the function in one file.
    const separator = target.function.lastIndexOf("#");
    const inFile = separator > 0 ? repoFile(root, target.function.slice(0, separator)) : undefined;
    const wanted = target.function
      .slice(separator + 1)
      .replace(/\(\)$/, "")
      .trim();
    const candidates = nodes.filter(
      (node) => node.kind === "symbol" && node.symbol && (!inFile || node.file === inFile),
    );
    // A default export also answers to its file name and the names it is imported under.
    const namesOf = (node: CodeNode): string[] => [
      node.name,
      node.symbol?.qualifiedName ?? "",
      node.label.replace(/\(\)$/, ""),
      ...((node.metadata.aliases as string[] | undefined) ?? []),
    ];
    let found = candidates.filter((node) => namesOf(node).includes(wanted));
    if (found.length === 0) {
      const lower = wanted.toLowerCase();
      found = candidates.filter((node) =>
        namesOf(node).some((name) => name.toLowerCase() === lower),
      );
    }
    const located = (node: CodeNode): string => `${node.label} (${node.file}:${node.line})`;
    if (found.length === 0) {
      const similar = candidates
        .filter((node) =>
          namesOf(node).some((name) => name.toLowerCase().includes(wanted.toLowerCase())),
        )
        .slice(0, 5)
        .map((node) => `Did you mean ${located(node)}?`);
      throw new NoFlowFoundError(
        `No function named "${wanted}" was found${inFile ? ` in ${inFile}` : ""}.`,
        similar,
      );
    }
    const files = [...new Set(found.map((node) => node.file))];
    if (files.length > 1) {
      const sorted = [...found].sort(
        (a, b) => (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0),
      );
      const listed = sorted.slice(0, 12).map(located);
      if (sorted.length > listed.length) listed.push(`… and ${sorted.length - listed.length} more`);
      const first = sorted[0];
      throw new NoFlowFoundError(`"${wanted}" matches functions in ${files.length} files.`, [
        ...listed,
        `Pick one with --function <file>#<name>, e.g. --function ${first?.file ?? ""}#${first?.name ?? wanted}`,
      ]);
    }
    for (const node of found) seeds.add(node.id);
  }

  if (target.file) {
    const file = repoFile(root, target.file);
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
    // "POST /v2/bookings (version 2024-08-13)", as NestJS routes are labelled.
    const versioned = /^(.*?)\s*\(versions?\s+([^)]*)\)\s*$/.exec(target.route);
    const requested = versioned?.[2]?.split(",").map((version) => version.trim());
    const match = /^\s*([A-Za-z]+)\s+(\S+)\s*$/.exec(versioned?.[1] ?? target.route);
    const method = match?.[1]?.toUpperCase();
    const routePath = normalizeRoute(match?.[2] ?? (versioned?.[1] ?? target.route).trim());
    const matching = nodes.filter(
      (node) =>
        node.kind === "route" &&
        !node.metadata.navigation &&
        normalizeRoute(String(node.metadata.path)) === routePath &&
        (!method || node.metadata.method === method || node.metadata.method === "ANY"),
    );
    const versionsOf = (node: CodeNode): string[] | undefined =>
      Array.isArray(node.metadata.versions) ? node.metadata.versions.map(String) : undefined;
    // Without a version, NestJS serves the routes for the default version.
    const routes = requested
      ? matching.filter((node) => versionsOf(node)?.some((v) => requested.includes(v)) ?? true)
      : matching.some((node) => node.metadata.servesDefault !== false)
        ? matching.filter((node) => node.metadata.servesDefault !== false)
        : matching;
    // A page (Next.js app/pages router, React Router) serves GET requests to its path; the flow
    // starts at its component. Server routes win when both match.
    const pagePaths = (node: CodeNode): string[] =>
      node.kind === "symbol" && Array.isArray(node.metadata.pages)
        ? node.metadata.pages.map(String)
        : [];
    const servesPages = !method || method === "GET";
    const pages =
      routes.length === 0 && servesPages
        ? nodes.filter((node) => pagePaths(node).some((page) => normalizeRoute(page) === routePath))
        : [];
    if (routes.length === 0 && pages.length === 0) {
      const candidates: RouteCandidate[] = nodes
        .filter((node) => node.kind === "route" && !node.metadata.navigation)
        .map((node) => ({
          label: node.label,
          path: String(node.metadata.path),
          method: asText(node.metadata.method),
        }));
      for (const node of nodes) {
        for (const page of pagePaths(node)) {
          candidates.push({ label: `GET ${page} (page ${node.label})`, path: page, method: "GET" });
        }
      }
      const available = closestRoutes(candidates, method, routePath).slice(0, 8);
      throw new NoFlowFoundError(
        `No route or page matches "${target.route}".`,
        available.map((candidate) => `Available: ${candidate.label}`),
      );
    }
    for (const node of [...routes, ...pages]) seeds.add(node.id);
  }
  return [...seeds];
}

/** A repository-relative path with forward slashes, from an absolute or relative one. */
function repoFile(root: string, file: string): string {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  return relative.split(path.sep).join("/").replace(/^\.\//, "");
}

/**
 * Orders routes by how close they are to a route that matched nothing, so a typo or a missing
 * prefix shows up first: routes with the requested method, then the most shared path segments
 * (a segment one or two typos away counts for half), then the smallest edit distance.
 */
interface RouteCandidate {
  label: string;
  path: string;
  method: string;
}

function closestRoutes(
  routes: readonly RouteCandidate[],
  method: string | undefined,
  routePath: string,
): RouteCandidate[] {
  const wanted = routePath.split("/").filter(Boolean);
  const ranked = routes.map((route) => {
    const candidatePath = normalizeRoute(route.path);
    return {
      route,
      method: !method || route.method === method || route.method === "ANY" ? 1 : 0,
      shared: sharedSegments(wanted, candidatePath.split("/").filter(Boolean)),
      distance: editDistance(routePath, candidatePath),
    };
  });
  ranked.sort(
    (a, b) =>
      b.method - a.method ||
      b.shared - a.shared ||
      a.distance - b.distance ||
      a.route.label.localeCompare(b.route.label),
  );
  return ranked.map((entry) => entry.route);
}

function sharedSegments(wanted: readonly string[], segments: readonly string[]): number {
  const unused = [...segments];
  let score = 0;
  for (const segment of wanted) {
    let best = -1;
    let bestScore = 0;
    unused.forEach((candidate, index) => {
      const value =
        candidate === segment
          ? 1
          : editDistance(candidate, segment) <= Math.min(2, Math.floor(segment.length / 3))
            ? 0.5
            : 0;
      if (value > bestScore) [best, bestScore] = [index, value];
    });
    if (best === -1) continue;
    score += bestScore;
    unused.splice(best, 1);
  }
  return score;
}

function normalizeRoute(route: string): string {
  const cleaned = `/${route.split(/[?#]/)[0] ?? ""}`.replace(/\/+/g, "/");
  const trimmed = cleaned.length > 1 ? cleaned.replace(/\/$/, "") : cleaned;
  return trimmed.replace(/\[(\w+)\]/g, ":$1").replace(/:\w+/g, ":param");
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
