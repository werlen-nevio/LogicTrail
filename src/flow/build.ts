import type { CodeEdge, CodeGraph, CodeNode, ResolvedStep } from "../analysis/code-graph.js";
import {
  GRAPH_SCHEMA_VERSION,
  type FlowRequest,
  type LogicEdge,
  type LogicEdgeType,
  type LogicNode,
  type LogicTrailGraph,
  type SourceEvidence,
} from "../graph/model.js";
import type { ExitFact } from "../indexer/facts.js";
import type { SelectedInferredEdge } from "../llm/validate.js";
import type { CandidateGraph } from "../query/candidates.js";
import type { SourceReader } from "../source.js";
import {
  exitDescription,
  exitLabel,
  exitType,
  isErrorExit,
  staticDescription,
} from "./describe.js";
import { narrateFlow } from "./narrate.js";

export interface FlowSelectionInput {
  title: string;
  /** Code graph ids chosen by the provider. */
  nodes: string[];
  entryPoints: string[];
  descriptions: ReadonlyMap<string, string>;
  inferredEdges: readonly SelectedInferredEdge[];
  explanation?: string;
}

export interface BuildFlowOptions {
  query: string;
  request?: FlowRequest;
  graph: CodeGraph;
  candidates: CandidateGraph;
  selection: FlowSelectionInput;
  source: SourceReader;
  analysis: LogicTrailGraph["analysis"];
  /** Upper bound on nodes in the final graph; the furthest steps are trimmed to meet it. */
  maxNodes?: number;
}

interface Attach {
  id: string;
  branch?: string;
  label?: string;
}

const SNIPPET_LINES = 60;

/**
 * Produces the final {@link LogicTrailGraph}: selected code nodes plus the
 * branch structure inside them (condition, error and response nodes), with
 * source evidence on every node and edge.
 */
export function buildFlowGraph(options: BuildFlowOptions): LogicTrailGraph {
  return new FlowBuilder(options).build();
}

class FlowBuilder {
  private readonly nodes = new Map<string, LogicNode>();
  private readonly edges: LogicEdge[] = [];
  private readonly edgeIndex = new Map<string, LogicEdge>();
  private included = new Set<string>();
  /** Condition, catch and exit nodes -> the code node whose body they belong to. */
  private readonly structuralOwner = new Map<string, string>();

  constructor(private readonly options: BuildFlowOptions) {}

  build(): LogicTrailGraph {
    const { graph, selection } = this.options;
    this.included = this.connect(selection.nodes, selection.entryPoints);

    for (const id of this.included) {
      const node = graph.nodes.get(id);
      if (node) this.nodes.set(id, this.codeNode(node));
    }
    for (const id of this.included) {
      const steps = graph.steps.get(id);
      if (steps) this.walk(id, steps, { id }, 0);
    }
    for (const edge of graph.inferredEdges) {
      if (this.included.has(edge.from) && this.included.has(edge.to))
        this.addCodeEdge(edge, { id: edge.from });
    }
    for (const edge of selection.inferredEdges) this.addInferredEdge(edge);
    this.pruneEmptyConditions();
    this.enforceBudget();
    this.attachCallSiteEvidence();

    const entryPoints = this.entryPoints();
    const ordered = this.orderNodes(entryPoints);
    const position = new Map(ordered.map((node, index) => [node.id, index]));
    // Stable sort: edges read top-down by source node, in source-code order within a node.
    const edges = [...this.edges].sort(
      (a, b) => (position.get(a.from) ?? 0) - (position.get(b.from) ?? 0),
    );
    const result: LogicTrailGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      query: this.options.query,
      ...(this.options.request ? { request: this.options.request } : {}),
      title: selection.title,
      entryPoints,
      nodes: ordered,
      edges: edges.map((edge, index) => ({ ...edge, id: `e${index + 1}` })),
      explanation: "",
      analysis: this.options.analysis,
    };
    result.explanation = selection.explanation ?? narrateFlow(result);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Selection connectivity

  /** Adds the intermediate candidates needed to connect selected nodes to an entry point. */
  private connect(selected: readonly string[], entryPoints: readonly string[]): Set<string> {
    const { candidates } = this.options;
    const set = new Set(selected.filter((id) => this.options.graph.nodes.has(id)));
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const edge of candidates.edges) {
      (outgoing.get(edge.from) ?? outgoing.set(edge.from, []).get(edge.from))?.push(edge.to);
      (incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to))?.push(edge.from);
    }
    const starts = entryPoints.filter((id) => set.has(id));
    const roots =
      starts.length > 0
        ? starts
        : [...set].filter((id) => !(incoming.get(id) ?? []).some((from) => set.has(from)));

    const reachable = new Set<string>();
    const expand = (from: readonly string[]): void => {
      const queue = [...from];
      while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined || reachable.has(id)) continue;
        reachable.add(id);
        for (const next of outgoing.get(id) ?? []) if (set.has(next)) queue.push(next);
      }
    };
    expand(roots);

    for (const id of selected) {
      if (reachable.has(id) || !set.has(id)) continue;
      const path = this.pathBackward(id, reachable, incoming);
      if (!path) continue;
      for (const step of path) set.add(step);
      expand(path);
      expand([id]);
    }
    return set;
  }

  private pathBackward(
    target: string,
    reachable: ReadonlySet<string>,
    incoming: ReadonlyMap<string, string[]>,
  ): string[] | undefined {
    const previous = new Map<string, string>();
    const queue = [target];
    const seen = new Set([target]);
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      for (const from of incoming.get(id) ?? []) {
        if (seen.has(from)) continue;
        seen.add(from);
        previous.set(from, id);
        if (reachable.has(from)) {
          const path: string[] = [];
          let cursor = previous.get(from);
          while (cursor && cursor !== target) {
            path.push(cursor);
            cursor = previous.get(cursor);
          }
          return path;
        }
        queue.push(from);
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Nodes

  private codeNode(code: CodeNode): LogicNode {
    const { graph, selection, source } = this.options;
    const llmDescription = selection.descriptions.get(code.id);
    const generated = staticDescription(code, graph);
    const evidence: SourceEvidence[] = [];
    if (code.file && code.line && (code.kind === "symbol" || code.kind === "route")) {
      evidence.push({
        file: code.file,
        line: code.line,
        kind: code.kind === "route" ? "route" : "definition",
        ...textEvidence(source.line(code.file, code.line)),
      });
    }
    const snippet =
      code.file && code.line
        ? code.kind === "symbol"
          ? source.snippet(code.file, code.line, code.endLine ?? code.line, SNIPPET_LINES)
          : source.snippet(code.file, code.line - 1, code.line + 3)
        : undefined;
    return {
      id: code.id,
      type: code.type,
      label: code.label,
      ...(code.file ? { file: code.file } : {}),
      ...(code.line ? { line: code.line } : {}),
      description: llmDescription ?? generated.text,
      descriptionSource: llmDescription ? "llm" : generated.source,
      evidence,
      ...(snippet ? { snippet } : {}),
      metadata: { ...code.metadata, kind: code.kind },
    };
  }

  private conditionNode(
    ownerId: string,
    step: Extract<ResolvedStep, { kind: "branch" | "catch" }>,
  ): LogicNode {
    const isCatch = step.kind === "catch";
    const id = `${isCatch ? "catch" : "cond"}:${ownerId}:${step.line}`;
    const existing = this.nodes.get(id);
    if (existing) return existing;
    const owner = this.nodes.get(ownerId)?.label ?? ownerId;
    const label = isCatch ? `catch${step.param ? ` (${step.param})` : ""}` : shorten(step.test, 48);
    const snippet = this.options.source.snippet(step.file, step.line, step.line + 3);
    const node: LogicNode = {
      id,
      type: "condition",
      label,
      file: step.file,
      line: step.line,
      description: isCatch
        ? `Error handling in ${owner}: runs when the code above throws.`
        : `${owner} branches on \`${step.test}\`.`,
      descriptionSource: "static",
      evidence: [
        {
          file: step.file,
          line: step.line,
          kind: "branch",
          ...textEvidence(this.options.source.line(step.file, step.line)),
        },
      ],
      ...(snippet ? { snippet } : {}),
      metadata: {
        kind: isCatch ? "catch" : "branch",
        owner: ownerId,
        ...(isCatch ? {} : { test: step.test }),
      },
    };
    this.nodes.set(id, node);
    this.structuralOwner.set(id, ownerId);
    return node;
  }

  private exitNode(ownerId: string, exit: ExitFact, file: string): LogicNode {
    const id = `exit:${file}:${exit.line}`;
    const existing = this.nodes.get(id);
    if (existing) return existing;
    const owner = this.nodes.get(ownerId)?.label ?? ownerId;
    const snippet = this.options.source.snippet(file, exit.line - 1, exit.line + 1);
    const node: LogicNode = {
      id,
      type: exitType(exit),
      label: exitLabel(exit),
      file,
      line: exit.line,
      description: exitDescription(exit, owner),
      descriptionSource: "static",
      evidence: [
        {
          file,
          line: exit.line,
          kind: "exit",
          ...textEvidence(this.options.source.line(file, exit.line) ?? exit.text),
        },
      ],
      ...(snippet ? { snippet } : {}),
      metadata: {
        kind: exit.kind,
        owner: ownerId,
        ...(exit.status !== undefined ? { status: exit.status } : {}),
        ...(exit.statusExpression ? { statusExpression: exit.statusExpression } : {}),
        ...(exit.errorName ? { errorName: exit.errorName } : {}),
        ...(exit.message ? { message: exit.message } : {}),
      },
    };
    this.nodes.set(id, node);
    this.structuralOwner.set(id, ownerId);
    return node;
  }

  // ---------------------------------------------------------------------------
  // Steps -> edges

  private walk(
    ownerId: string,
    steps: readonly ResolvedStep[],
    attach: Attach,
    depth: number,
  ): void {
    let current = attach;
    for (const step of steps) {
      switch (step.kind) {
        case "edge":
          if (this.included.has(step.edge.to)) this.addCodeEdge(step.edge, current);
          break;
        case "exit": {
          if (!this.includeExit(step.exit, depth)) break;
          const node = this.exitNode(ownerId, step.exit, step.file);
          this.addEdge({
            from: current.id,
            to: node.id,
            type: "returns",
            ...branchFields(current),
            confidence: 1,
            source: "static",
            evidence: [
              {
                file: step.file,
                line: step.exit.line,
                kind: "exit",
                ...textEvidence(this.options.source.line(step.file, step.exit.line)),
              },
            ],
          });
          break;
        }
        case "branch": {
          if (!step.arms.some((arm) => this.relevant(arm.steps, depth + 1))) break;
          const condition = this.conditionNode(ownerId, step);
          this.addEdge({
            from: current.id,
            to: condition.id,
            type: "condition",
            ...branchFields(current),
            confidence: 1,
            source: "static",
            evidence: [
              {
                file: step.file,
                line: step.line,
                kind: "branch",
                ...textEvidence(this.options.source.line(step.file, step.line)),
              },
            ],
          });
          for (const arm of step.arms) {
            const label = armLabel(arm.label);
            this.walk(ownerId, arm.steps, { id: condition.id, branch: label, label }, depth + 1);
          }
          const thenArm = step.arms.find((arm) => arm.label === "then");
          const elseArm = step.arms.find((arm) => arm.label === "else");
          if (thenArm?.terminates && !elseArm?.terminates) {
            current = { id: condition.id, branch: "no", label: "no" };
          } else if (elseArm?.terminates && thenArm && !thenArm.terminates) {
            current = { id: condition.id, branch: "yes", label: "yes" };
          }
          break;
        }
        case "catch": {
          if (!this.relevant(step.steps, depth + 1)) break;
          const handler = this.conditionNode(ownerId, step);
          this.addEdge({
            from: current.id,
            to: handler.id,
            type: "condition",
            ...(current.branch ? { branch: current.branch } : {}),
            label: current.label ?? "on error",
            confidence: 1,
            source: "static",
            evidence: [
              {
                file: step.file,
                line: step.line,
                kind: "branch",
                ...textEvidence(this.options.source.line(step.file, step.line)),
              },
            ],
          });
          this.walk(ownerId, step.steps, { id: handler.id, branch: "error" }, depth + 1);
          break;
        }
      }
    }
  }

  private relevant(steps: readonly ResolvedStep[], depth: number): boolean {
    return steps.some((step) => {
      switch (step.kind) {
        case "edge":
          return this.included.has(step.edge.to);
        case "exit":
          return this.includeExit(step.exit, depth);
        case "branch":
          return step.arms.some((arm) => this.relevant(arm.steps, depth + 1));
        case "catch":
          return this.relevant(step.steps, depth + 1);
      }
    });
  }

  /** Error exits always matter; successful responses only when they end a branch. */
  private includeExit(exit: ExitFact, depth: number): boolean {
    return isErrorExit(exit) || depth > 0;
  }

  private addCodeEdge(edge: CodeEdge, attach: Attach): void {
    const fromRoute = this.options.graph.nodes.get(edge.from)?.kind === "route";
    // Inferred webhook edges point at the route registration as their evidence.
    const toRoute =
      Boolean(edge.inferred) && this.options.graph.nodes.get(edge.to)?.kind === "route";
    const label = attach.label ?? edge.label;
    this.addEdge({
      from: attach.id,
      to: edge.to,
      type: edge.kind,
      ...(label ? { label } : {}),
      ...(attach.branch ? { branch: attach.branch } : {}),
      confidence: edge.confidence,
      source: edge.inferred ? "inferred" : "static",
      ...(edge.inferred ? { reason: edge.inferred.reason } : {}),
      evidence: [
        {
          file: edge.file,
          line: edge.line,
          kind: fromRoute || toRoute ? "route" : evidenceKind(edge.kind),
          ...textEvidence(this.options.source.line(edge.file, edge.line) ?? edge.text),
        },
      ],
    });
  }

  private addInferredEdge(edge: SelectedInferredEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) return;
    this.addEdge({
      from: edge.from,
      to: edge.to,
      type: edge.kind,
      ...(edge.label ? { label: edge.label } : {}),
      confidence: edge.confidence,
      source: "inferred",
      reason: edge.reason,
      evidence: [],
    });
  }

  private addEdge(edge: Omit<LogicEdge, "id">): void {
    if (edge.from === edge.to) return;
    const key = `${edge.from}\0${edge.to}\0${edge.type}\0${edge.branch ?? ""}`;
    const existing = this.edgeIndex.get(key);
    if (existing) {
      for (const item of edge.evidence ?? []) {
        const evidence = (existing.evidence ??= []);
        if (!evidence.some((known) => known.file === item.file && known.line === item.line))
          evidence.push(item);
      }
      existing.confidence = Math.max(existing.confidence, edge.confidence);
      return;
    }
    const created: LogicEdge = { id: "", ...edge };
    this.edgeIndex.set(key, created);
    this.edges.push(created);
  }

  // ---------------------------------------------------------------------------
  // Finishing

  private pruneEmptyConditions(): void {
    for (;;) {
      const withOutgoing = new Set(this.edges.map((edge) => edge.from));
      const empty = [...this.nodes.values()].filter(
        (node) => node.type === "condition" && !withOutgoing.has(node.id),
      );
      if (empty.length === 0) return;
      for (const node of empty) this.nodes.delete(node.id);
      const removed = new Set(empty.map((node) => node.id));
      const kept = this.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to));
      this.edges.length = 0;
      this.edges.push(...kept);
    }
  }

  /**
   * Keeps the flow within --max-nodes by trimming the steps furthest from the entry points. At
   * each distance a function's branches (its condition, error and response nodes) are collapsed
   * into the function before functions themselves are left out, and less relevant ones go first.
   * Entry points are always kept.
   */
  private enforceBudget(): void {
    const max = this.options.maxNodes;
    if (max === undefined || this.nodes.size <= max) return;
    const before = this.nodes.size;
    const entries = new Set(this.entryPoints());
    const ownerOf = (id: string): string => this.structuralOwner.get(id) ?? id;

    // Calls between code nodes, with branch nodes standing in for their function.
    const calls = new Map<string, Set<string>>();
    for (const edge of this.edges) {
      if (this.structuralOwner.has(edge.to)) continue;
      const from = ownerOf(edge.from);
      (calls.get(from) ?? calls.set(from, new Set()).get(from))?.add(edge.to);
    }
    const depth = new Map<string, number>();
    const queue = [...entries];
    for (const id of queue) depth.set(id, 0);
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index] ?? "";
      for (const next of calls.get(id) ?? []) {
        if (depth.has(next)) continue;
        depth.set(next, (depth.get(id) ?? 0) + 1);
        queue.push(next);
      }
    }
    const unreached = Math.max(0, ...depth.values()) + 1;
    const distance = (id: string): number => depth.get(id) ?? unreached;
    const selected = this.options.selection.nodes;
    const rank = new Map(selected.map((id, index) => [id, index]));
    const rankOf = (id: string): number => rank.get(id) ?? selected.length;

    const collapsed = new Map<string, number>();
    const dropped: string[] = [];
    while (this.nodes.size > max) {
      const owned = new Map<string, number>();
      const callers = new Set<string>();
      for (const id of this.nodes.keys()) {
        const owner = this.structuralOwner.get(id);
        if (owner) owned.set(owner, (owned.get(owner) ?? 0) + 1);
      }
      for (const edge of this.edges) {
        if (!this.structuralOwner.has(edge.to)) callers.add(ownerOf(edge.from));
      }
      const units: { id: string; branches: boolean; priority: number; cost: number }[] = [
        ...[...owned].map(([id, cost]) => ({
          id,
          branches: true,
          priority: distance(id) + 1,
          cost,
        })),
        ...[...this.nodes.keys()]
          .filter((id) => !this.structuralOwner.has(id) && !entries.has(id) && !callers.has(id))
          .map((id) => ({
            id,
            branches: false,
            priority: distance(id),
            cost: 1 + (owned.get(id) ?? 0),
          })),
      ];
      units.sort(
        (a, b) =>
          b.priority - a.priority ||
          Number(b.branches) - Number(a.branches) ||
          rankOf(b.id) - rankOf(a.id) ||
          a.id.localeCompare(b.id),
      );
      // Close to the budget, take the most relevant unit that doesn't cut more than needed.
      const excess = this.nodes.size - max;
      const unit =
        units.find((candidate) => candidate.cost <= excess) ??
        units.reduce<(typeof units)[number] | undefined>(
          (best, candidate) => (!best || candidate.cost < best.cost ? candidate : best),
          undefined,
        );
      if (!unit) break;
      if (unit.branches) {
        collapsed.set(unit.id, (collapsed.get(unit.id) ?? 0) + this.collapseBranches(unit.id));
      } else {
        dropped.push(this.nodes.get(unit.id)?.label ?? unit.id);
        this.removeNodes((id) => id === unit.id || this.structuralOwner.get(id) === unit.id);
      }
    }
    this.pruneEmptyConditions();

    for (const [owner, hidden] of collapsed) {
      const node = this.nodes.get(owner);
      if (!node) continue;
      node.metadata = { ...node.metadata, hiddenBranchNodes: hidden };
      node.description =
        `${node.description ?? ""} (${hidden} branch ${hidden === 1 ? "step" : "steps"} hidden to stay within --max-nodes.)`.trim();
    }
    const kept = [...collapsed.keys()].filter((id) => this.nodes.has(id));
    const hidden = kept.reduce((sum, id) => sum + (collapsed.get(id) ?? 0), 0);
    const parts: string[] = [];
    if (kept.length > 0) {
      parts.push(
        `collapsed the branches of ${plural(kept.length, "function")} (${plural(hidden, "condition, error or response node")}): ${listed(kept.map((id) => this.nodes.get(id)?.label ?? id))}`,
      );
    }
    if (dropped.length > 0) {
      parts.push(
        `left out ${plural(dropped.length, "step")} furthest from the entry point: ${listed(dropped)}`,
      );
    }
    if (parts.length > 0) {
      this.options.analysis.warnings.push(
        `The flow had ${before} nodes, more than --max-nodes ${max}, so LogicTrail ${parts.join("; and ")}. Raise --max-nodes to see more.`,
      );
    }
  }

  /** Removes a function's branch nodes; calls made inside them start at the function. */
  private collapseBranches(owner: string): number {
    const hidden = new Set(
      [...this.nodes.keys()].filter((id) => this.structuralOwner.get(id) === owner),
    );
    const edges = [...this.edges];
    this.edges.length = 0;
    this.edgeIndex.clear();
    for (const edge of edges) {
      if (hidden.has(edge.to)) continue;
      if (!hidden.has(edge.from)) {
        this.addEdge(edge);
        continue;
      }
      this.addEdge({
        from: owner,
        to: edge.to,
        type: edge.type,
        confidence: edge.confidence,
        source: edge.source,
        ...(edge.reason ? { reason: edge.reason } : {}),
        ...(edge.evidence ? { evidence: edge.evidence } : {}),
      });
    }
    for (const id of hidden) this.nodes.delete(id);
    return hidden.size;
  }

  private removeNodes(remove: (id: string) => boolean): void {
    const removed = new Set([...this.nodes.keys()].filter(remove));
    for (const id of removed) this.nodes.delete(id);
    const edges = this.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to));
    this.edges.length = 0;
    this.edgeIndex.clear();
    for (const edge of edges) this.addEdge(edge);
  }

  /**
   * Nodes without a definition of their own (database, external, events) get
   * their call sites as evidence: the ones inside this flow, or else the call
   * sites anywhere in the repository.
   */
  private attachCallSiteEvidence(): void {
    for (const node of this.nodes.values()) {
      if (node.file && node.line) continue;
      const evidence: SourceEvidence[] = [];
      const add = (item: SourceEvidence): void => {
        if (!evidence.some((known) => known.file === item.file && known.line === item.line)) {
          evidence.push(item);
        }
      };
      for (const edge of this.edges) {
        if (edge.to === node.id) for (const item of edge.evidence ?? []) add(item);
      }
      if (evidence.length === 0) {
        for (const edge of this.options.graph.in(node.id)) {
          if (edge.inferred) continue;
          add({
            file: edge.file,
            line: edge.line,
            kind: evidenceKind(edge.kind),
            ...textEvidence(this.options.source.line(edge.file, edge.line) ?? edge.text),
          });
        }
      }
      node.evidence = evidence;
      const first = evidence[0];
      if (first) {
        node.file = first.file;
        node.line = first.line;
        const snippet = this.options.source.snippet(first.file, first.line - 1, first.line + 1);
        if (snippet) node.snippet = snippet;
      }
    }
  }

  private entryPoints(): string[] {
    const chosen = this.options.selection.entryPoints.filter((id) => this.nodes.has(id));
    if (chosen.length > 0) return chosen;
    const targets = new Set(this.edges.map((edge) => edge.to));
    return [...this.nodes.values()]
      .filter((node) => !targets.has(node.id) && node.type !== "condition")
      .map((node) => node.id);
  }

  private orderNodes(entryPoints: readonly string[]): LogicNode[] {
    const ordered: LogicNode[] = [];
    const seen = new Set<string>();
    const outgoing = new Map<string, string[]>();
    for (const edge of this.edges) {
      (outgoing.get(edge.from) ?? outgoing.set(edge.from, []).get(edge.from))?.push(edge.to);
    }
    const queue = [...entryPoints];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || seen.has(id)) continue;
      const node = this.nodes.get(id);
      if (!node) continue;
      seen.add(id);
      ordered.push(node);
      queue.push(...(outgoing.get(id) ?? []));
    }
    for (const node of this.nodes.values()) if (!seen.has(node.id)) ordered.push(node);
    return ordered;
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "a, b, c and 4 more" */
function listed(names: readonly string[], limit = 3): string {
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
}

function armLabel(label: string): string {
  if (label === "then") return "yes";
  if (label === "else") return "no";
  // `case "paid"` -> `paid`
  return shorten(label.replace(/^case /, "").replace(/^(["'`])(.*)\1$/, "$2"), 32);
}

function branchFields(attach: Attach): { branch?: string; label?: string } {
  return {
    ...(attach.branch ? { branch: attach.branch } : {}),
    ...(attach.label ? { label: attach.label } : {}),
  };
}

function evidenceKind(type: LogicEdgeType): SourceEvidence["kind"] {
  switch (type) {
    case "emits":
      return "emit";
    case "triggers":
      return "listener";
    case "renders":
      return "reference";
    case "returns":
      return "exit";
    case "condition":
      return "branch";
    default:
      return "call";
  }
}

function textEvidence(text: string | undefined): { text?: string } {
  const trimmed = text?.trim();
  return trimmed ? { text: shorten(trimmed, 160) } : {};
}

function shorten(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}
