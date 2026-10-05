import type { CodeGraph, CodeNode } from "../analysis/code-graph.js";
import { tokenize, type QueryTerm } from "./terms.js";
import { asText } from "../util/text.js";

/** Path segments that say nothing about behavior. */
const GENERIC_PATH_WORDS = new Set([
  "src",
  "lib",
  "app",
  "apps",
  "packages",
  "package",
  "component",
  "components",
  "index",
  "util",
  "utils",
  "server",
  "client",
  "page",
  "pages",
  "route",
  "routes",
  "controller",
  "controllers",
  "service",
  "services",
  "hook",
  "hooks",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "web",
  "api",
  "core",
  "common",
  "shared",
  "modul",
  "modules",
  "helper",
  "helpers",
  "internal",
  "main",
  "test",
]);

export interface ScoredNode {
  id: string;
  score: number;
  /** Part of the score that comes from the question's own words (not synonyms). */
  directScore: number;
  /** Query terms that matched this node. */
  matched: string[];
}

type TermWeights = Map<string, number>;

/**
 * A small lexical search index over code-graph nodes. Each node is described
 * by weighted fields (name, owner, file path, docs, literals, routes, ...);
 * scoring is BM25-style IDF times the best field weight per query term.
 */
export class RetrievalIndex {
  private readonly documents = new Map<string, TermWeights>();
  private readonly documentFrequency = new Map<string, number>();

  constructor(private readonly graph: CodeGraph) {
    for (const node of graph.nodes.values()) {
      const weights = this.describe(node);
      this.documents.set(node.id, weights);
      for (const term of weights.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
    }
  }

  score(terms: readonly QueryTerm[]): ScoredNode[] {
    const total = this.documents.size;
    const idf = new Map<string, number>();
    for (const { term } of terms) {
      const frequency = this.documentFrequency.get(term) ?? 0;
      idf.set(term, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)));
    }
    const results: ScoredNode[] = [];
    for (const [id, weights] of this.documents) {
      let score = 0;
      let directScore = 0;
      const matched: string[] = [];
      let directMatches = 0;
      for (const term of terms) {
        const weight = weights.get(term.term);
        if (!weight) continue;
        const contribution = term.weight * (idf.get(term.term) ?? 0) * weight;
        score += contribution;
        matched.push(term.term);
        if (term.source === "query") {
          directMatches++;
          directScore += contribution;
        }
      }
      if (score <= 0) continue;
      if (directMatches > 1) score *= 1 + 0.25 * (directMatches - 1);
      results.push({ id, score, directScore, matched });
    }
    return results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }

  /** Terms indexed for a node (exposed for diagnostics and tests). */
  termsOf(id: string): ReadonlyMap<string, number> | undefined {
    return this.documents.get(id);
  }

  private describe(node: CodeNode): TermWeights {
    const weights: TermWeights = new Map();
    const add = (text: string | undefined, weight: number): void => {
      if (!text) return;
      for (const term of tokenize(text)) {
        if ((weights.get(term) ?? 0) < weight) weights.set(term, weight);
      }
    };
    switch (node.kind) {
      case "symbol": {
        const symbol = node.symbol;
        add(node.name, 3);
        if (symbol?.owner) add(symbol.owner, 1.5);
        if (symbol?.parent) add(symbol.parent, 1.5);
        if (node.file) add(pathWords(node.file), 1.2);
        add(symbol?.doc, 1);
        for (const literal of symbol?.literals ?? []) add(literal, 0.6);
        for (const page of (node.metadata.pages as string[] | undefined) ?? []) add(page, 2.5);
        for (const edge of this.graph.in(node.id)) {
          const caller = this.graph.nodes.get(edge.from);
          if (caller?.kind === "route" && edge.label !== "middleware") add(caller.name, 2.5);
          if (caller?.kind === "event") add(caller.name, 2);
        }
        for (const env of symbol?.envVars ?? []) add(env, 0.5);
        break;
      }
      case "route":
        add(node.name, 3);
        break;
      case "database":
        add(node.name, 2);
        add(asText(node.metadata.operation), 1);
        add(asText(node.metadata.system), 0.5);
        break;
      case "external":
        add(node.name, 2);
        add(asText(node.metadata.operation), 1.5);
        break;
      case "library":
        add(node.label, 1);
        add(asText(node.metadata.category), 1);
        break;
      case "event":
        add(node.name, 3);
        break;
      case "navigation":
        add(node.name, 1.5);
        break;
    }
    return weights;
  }
}

function pathWords(file: string): string {
  return file
    .replace(/\.[^.]+$/, "")
    .split("/")
    .filter((segment) => !GENERIC_PATH_WORDS.has(segment.toLowerCase()))
    .join(" ");
}
