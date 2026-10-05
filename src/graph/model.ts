/**
 * The public LogicTrail graph model.
 *
 * This is the contract shared by the flow builder, every renderer, the HTML
 * viewer and the JSON output. It must stay free of runtime imports so the
 * browser viewer can use it as a type-only dependency.
 */

export const GRAPH_SCHEMA_VERSION = 1;

export type LogicNodeType =
  | "component"
  | "function"
  | "route"
  | "service"
  | "database"
  | "external"
  | "library"
  | "condition"
  | "event"
  | "error"
  | "response";

export type LogicEdgeType =
  | "calls"
  | "requests"
  | "returns"
  | "reads"
  | "writes"
  | "emits"
  | "condition"
  | "renders"
  | "triggers"
  | "navigates";

/** Where a piece of information comes from. */
export type EvidenceSource = "static" | "inferred";

export interface SourceEvidence {
  /** Repository-relative path using forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The relevant source line (trimmed), when available. */
  text?: string;
  /** What this evidence demonstrates, e.g. "definition", "call", "route". */
  kind: "definition" | "call" | "route" | "reference" | "emit" | "listener" | "branch" | "exit";
}

export interface SourceSnippet {
  /** Line number of the first entry in `lines`. */
  startLine: number;
  lines: string[];
  /** True when the snippet was cut short. */
  truncated: boolean;
}

export interface LogicNode {
  id: string;
  type: LogicNodeType;
  label: string;
  file?: string;
  line?: number;
  description?: string;
  /** Where the description came from: the LLM, a doc comment, or generated from code facts. */
  descriptionSource?: "llm" | "doc" | "static";
  evidence?: SourceEvidence[];
  /** Source of the node definition, embedded so the HTML viewer works offline. */
  snippet?: SourceSnippet;
  metadata?: Record<string, unknown>;
}

export interface LogicEdge {
  id: string;
  from: string;
  to: string;
  type: LogicEdgeType;
  label?: string;
  /**
   * Set for edges that leave a condition node: the branch arm that leads to
   * the target ("yes", "no", "error", "case 'x'").
   */
  branch?: string;
  /** 0..1. Statically proven edges are 1 unless matched heuristically. */
  confidence: number;
  source: EvidenceSource;
  /** For inferred edges: why the LLM believes this relationship exists. */
  reason?: string;
  evidence?: SourceEvidence[];
}

/** How a flow was requested, so it can be re-run against newer code (`logictrail update`). */
export interface FlowRequest {
  /** The question as asked; absent when the flow was requested by a starting point only. */
  question?: string;
  file?: string;
  function?: string;
  route?: string;
  maxDepth: number;
  maxNodes: number;
}

export interface LogicTrailGraph {
  schemaVersion: typeof GRAPH_SCHEMA_VERSION;
  query: string;
  /** Absent in flows written before `logictrail update` existed. */
  request?: FlowRequest;
  title: string;
  entryPoints: string[];
  nodes: LogicNode[];
  edges: LogicEdge[];
  explanation: string;
  /** Who produced the semantic layer (selection, descriptions, explanation). */
  analysis: {
    provider: string;
    model?: string;
    generatedAt: string;
    repository: string;
    /** Absolute path of the analyzed root, used for "open in editor" links. */
    rootPath?: string;
    stats: {
      files: number;
      symbols: number;
      relationships: number;
      candidates: number;
    };
    warnings: string[];
  };
}
