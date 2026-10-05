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

export function chooseSeeds(
  scored: readonly ScoredNode[],
  options: { limit: number; ratio: number },
): string[] {
  const top = scored[0]?.score ?? 0;
  if (top <= 0) return [];
  return scored
    .filter((node) => node.score >= top * options.ratio)
    .slice(0, options.limit)
    .map((node) => node.id);
}

/**
 * Builds the sub-graph relevant to a question.
 *
 * - Seeds come from retrieval (or from an explicit --file/--function/--route).
 * - Upstream, only the callers on a path to a seed are added, and only when
 *   they are relevant themselves or are natural triggers (routes, events).
 *   This finds entry points (pages, routes) without dragging in siblings.
 * - Downstream, everything a seed reaches is followed up to `maxDepth`,
 *   except rendering of unrelated child components.
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
  for (const seed of seeds) {
    if (graph.nodes.has(seed))
      nodes.set(seed, { id: seed, score: score(seed), depth: 0, role: "seed" });
  }

  // Downstream first so callers cannot crowd out the flow itself.
  const queue: { id: string; depth: number }[] = [...nodes.keys()].map((id) => ({ id, depth: 0 }));
  for (let cursor = 0; cursor < queue.length && nodes.size < options.maxCandidates; cursor++) {
    const current = queue[cursor];
    if (!current || current.depth >= options.maxDepth) continue;
    for (const edge of graph.out(current.id)) {
      if (nodes.has(edge.to)) continue;
      const target = graph.nodes.get(edge.to);
      if (!target) continue;
      if (edge.kind === "renders" && !followRender(edge.to)) continue;
      nodes.set(edge.to, {
        id: edge.to,
        score: score(edge.to),
        depth: current.depth + 1,
        role: "callee",
      });
      queue.push({ id: edge.to, depth: current.depth + 1 });
      if (nodes.size >= options.maxCandidates) break;
    }
  }

  // Upstream: follow callers that are relevant or are triggers.
  let frontier = [...seeds];
  for (let level = 1; level <= options.upDepth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of graph.in(id)) {
        if (nodes.has(edge.from) || nodes.size >= options.maxCandidates) continue;
        const caller = graph.nodes.get(edge.from);
        if (!caller) continue;
        const relevant =
          score(edge.from) > 0 ||
          TRIGGER_KINDS.has(caller.kind) ||
          (caller.symbol?.kind === "handler" && edge.kind !== "renders");
        if (!relevant) continue;
        nodes.set(edge.from, {
          id: edge.from,
          score: score(edge.from),
          depth: -level,
          role: "caller",
        });
        next.push(edge.from);
      }
    }
    frontier = next;
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
