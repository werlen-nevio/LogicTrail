import type { CodeEdge, CodeGraph } from "../analysis/code-graph.js";
import type { ScoredNode } from "./retrieve.js";

export interface CandidateOptions {
  /** Maximum hops downstream of a seed. */
  maxDepth: number;
  /** Hard cap on the candidate set size. */
  maxCandidates: number;
  /** Maximum hops upstream of a seed when looking for entry points. */
  upDepth: number;
}

export interface Candidate {
  id: string;
  score: number;
  /** Hops from the nearest seed (negative for callers). */
  depth: number;
  role: "seed" | "caller" | "callee";
}

export interface CandidateGraph {
  nodes: Map<string, Candidate>;
  edges: CodeEdge[];
  seeds: string[];
  entryPoints: string[];
}

/** Nodes that start a flow when found upstream of a seed. */
const TRIGGER_KINDS = new Set(["route", "event"]);

export interface SeedOptions {
  limit: number;
  /** Minimum score relative to the best match. */
  ratio: number;
  /** Downstream hops within which a seed makes another one redundant. */
  maxDepth: number;
  /** Seeds taken from one file at most. */
  perFile?: number;
}

/**
 * Picks the nodes a question is about. A match is weighed by how many of the question's words it
 * covers compared with the best match, so "an article is created" prefers `createArticle` over
 * `createUser`. Near-identical versioned symbols (`SlotsController_2024_04_15`,
 * `SlotsController_2024_09_04`) count once, a node another seed already reaches is no seed of its
 * own, and one file contributes a few seeds at most, so the budget isn't spread thin.
 */
export function chooseSeeds(
  graph: CodeGraph,
  scored: readonly ScoredNode[],
  options: SeedOptions,
): string[] {
  const coverage = Math.max(0, ...scored.slice(0, 50).map((node) => node.direct.length));
  const ranked = scored
    .slice(0, options.limit * 6)
    .map((node) => {
      const covered = coverage > 0 ? (node.score * node.direct.length) / coverage : node.score;
      const file = graph.nodes.get(node.id)?.file ?? "";
      return {
        id: node.id,
        // Tests, mocks and fixtures exercise a flow; they rarely are where it starts.
        score: TEST_FILE.test(file) ? covered * 0.3 : covered,
        calls: graph.out(node.id).length,
      };
    })
    // Ties go to nodes that call more: a flow starts better from a hub than from a leaf.
    .sort((a, b) => b.score - a.score || b.calls - a.calls || a.id.localeCompare(b.id));
  const top = ranked[0]?.score ?? 0;
  if (top <= 0) return [];

  const seeds: string[] = [];
  const families = new Set<string>();
  const perFile = new Map<string, number>();
  const reached = new Set<string>();
  for (const { id, score } of ranked) {
    if (score < top * options.ratio || seeds.length >= options.limit) break;
    const node = graph.nodes.get(id);
    if (!node || reached.has(id)) continue;
    const family = `${node.kind}:${withoutVersion(node.label)}`;
    if (families.has(family)) continue;
    const file = node.file ?? "";
    if (file && (perFile.get(file) ?? 0) >= (options.perFile ?? 3)) continue;
    families.add(family);
    if (file) perFile.set(file, (perFile.get(file) ?? 0) + 1);
    seeds.push(id);
    for (const target of reachable(graph, id, options.maxDepth)) reached.add(target);
  }
  // A later seed may reach an earlier one; keep only seeds no other seed reaches.
  return seeds.filter(
    (seed) =>
      !seeds.some((other) => other !== seed && reachable(graph, other, options.maxDepth).has(seed)),
  );
}

const TEST_FILE =
  /(^|\/)(__tests__|__mocks__|tests?|testing|e2e|playwright|cypress|fixtures|mocks?)\/|\.(test|spec|e2e)\.[^/]+$/i;

/** "SlotsController_2024_04_15.getAvailableSlots()" -> "SlotsController.getAvailableSlots()". */
function withoutVersion(label: string): string {
  return label.replace(/_?\d{4}_\d{2}_\d{2}|_?[vV]\d+(?=\b|_|[A-Z.])/g, "");
}

const reachCache = new WeakMap<CodeGraph, Map<string, Set<string>>>();

function reachable(graph: CodeGraph, from: string, maxDepth: number): Set<string> {
  const cache = reachCache.get(graph) ?? new Map<string, Set<string>>();
  reachCache.set(graph, cache);
  const key = `${maxDepth}:${from}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const seen = new Set<string>();
  let frontier = [from];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of graph.out(id)) {
        if (edge.to === from || seen.has(edge.to)) continue;
        seen.add(edge.to);
        next.push(edge.to);
      }
    }
    frontier = next;
  }
  cache.set(key, seen);
  return seen;
}

/** How much a step away from a seed costs: downstream, and upstream towards an entry point. */
const DOWN = 0.6;
const UP = 0.8;
/** How much a node's own relevance lifts it over the path that leads to it. */
const RELEVANCE = 0.5;

interface Pending {
  id: string;
  priority: number;
  depth: number;
  role: Candidate["role"];
  /** Downstream hops left from here. */
  down: number;
  /** Upstream hops taken so far (callers only). */
  up: number;
  order: number;
}

/**
 * Builds the sub-graph relevant to a question, best first.
 *
 * - Seeds come from retrieval (or from an explicit --file/--function/--route).
 * - Every reachable node gets a priority: its parent's, discounted per hop, plus part of its own
 *   relevance. The highest priority is added next until the budget is spent, so the core path
 *   and the code that matches the question win over leaves far from it.
 * - Downstream, everything a seed reaches is followed up to `maxDepth`, except rendering of
 *   unrelated child components.
 * - Upstream, only callers that are relevant themselves or are natural triggers (routes, events)
 *   are followed. This finds entry points (pages, routes) without dragging in siblings; a caller
 *   that is relevant itself also brings in what else it calls, at a lower priority.
 */
export function extractCandidates(
  graph: CodeGraph,
  scores: ReadonlyMap<string, number>,
  seeds: readonly string[],
  options: CandidateOptions,
  /** Nodes matching the question's own words; child components are followed only when listed here. */
  directMatches?: ReadonlySet<string>,
): CandidateGraph {
  const nodes = new Map<string, Candidate>();
  const score = (id: string): number => scores.get(id) ?? 0;
  const followRender = (id: string): boolean =>
    directMatches ? directMatches.has(id) : score(id) > 0;

  const pending: Pending[] = [];
  let order = 0;
  const push = (entry: Omit<Pending, "order">): void => {
    if (!nodes.has(entry.id)) pending.push({ ...entry, order: order++ });
  };
  const best = Math.max(1, ...seeds.map(score));
  for (const seed of seeds) {
    if (!graph.nodes.has(seed)) continue;
    push({
      id: seed,
      priority: score(seed) || best,
      depth: 0,
      role: "seed",
      down: options.maxDepth,
      up: 0,
    });
  }

  while (pending.length > 0 && nodes.size < options.maxCandidates) {
    let index = 0;
    for (let i = 1; i < pending.length; i++) {
      const a = pending[i];
      const b = pending[index];
      if (a && b && (a.priority > b.priority || (a.priority === b.priority && a.order < b.order)))
        index = i;
    }
    const current = pending.splice(index, 1)[0];
    if (!current || nodes.has(current.id)) continue;
    nodes.set(current.id, {
      id: current.id,
      score: score(current.id),
      depth: current.depth,
      role: current.role,
    });

    const expandsDown = current.role !== "caller" || score(current.id) > 0;
    if (expandsDown && current.down > 0) {
      for (const edge of graph.out(current.id)) {
        if (nodes.has(edge.to) || !graph.nodes.has(edge.to)) continue;
        if (edge.kind === "renders" && !followRender(edge.to)) continue;
        push({
          id: edge.to,
          priority: current.priority * DOWN + RELEVANCE * score(edge.to),
          depth: Math.abs(current.depth) + 1,
          role: "callee",
          down: current.down - 1,
          up: 0,
        });
      }
    }
    if (current.role === "seed" || current.role === "caller") {
      if (current.up >= options.upDepth) continue;
      for (const edge of graph.in(current.id)) {
        if (nodes.has(edge.from)) continue;
        const caller = graph.nodes.get(edge.from);
        if (!caller) continue;
        const relevant =
          score(edge.from) > 0 ||
          TRIGGER_KINDS.has(caller.kind) ||
          (caller.symbol?.kind === "handler" && edge.kind !== "renders");
        if (!relevant) continue;
        push({
          id: edge.from,
          priority: current.priority * UP + RELEVANCE * score(edge.from),
          depth: -(current.up + 1),
          role: "caller",
          down: options.maxDepth - 1,
          up: current.up + 1,
        });
      }
    }
  }

  const edges: CodeEdge[] = [];
  for (const id of nodes.keys()) {
    for (const edge of graph.out(id)) {
      if (nodes.has(edge.to) && edge.to !== id) edges.push(edge);
    }
  }
  return { nodes, edges, seeds: [...seeds], entryPoints: findEntryPoints(nodes, edges) };
}

/** Candidates without incoming edges from other candidates, best first. */
export function findEntryPoints(
  nodes: ReadonlyMap<string, Candidate>,
  edges: readonly CodeEdge[],
): string[] {
  const hasIncoming = new Set(edges.filter((edge) => edge.from !== edge.to).map((edge) => edge.to));
  const roots = [...nodes.values()].filter(
    (node) => !hasIncoming.has(node.id) && hasOutgoing(node.id, edges),
  );
  roots.sort((a, b) => a.depth - b.depth || b.score - a.score);
  if (roots.length > 0) return roots.map((node) => node.id);
  const best = [...nodes.values()].sort((a, b) => b.score - a.score)[0];
  return best ? [best.id] : [];
}

function hasOutgoing(id: string, edges: readonly CodeEdge[]): boolean {
  return edges.some((edge) => edge.from === id);
}
