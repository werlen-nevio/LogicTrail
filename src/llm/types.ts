import type { LogicEdgeType, LogicNodeType } from "../graph/model.js";

/** A candidate node as presented to a provider. `ref` is a short prompt-friendly id ("n12"). */
export interface CandidateNodeInfo {
  ref: string;
  id: string;
  type: LogicNodeType;
  label: string;
  file?: string;
  line?: number;
  score: number;
  role: "seed" | "caller" | "callee";
  signature?: string;
  doc?: string;
  /** Source excerpt with line numbers, when within the prompt budget. */
  snippet?: string;
  details: string[];
}

export interface CandidateEdgeInfo {
  from: string;
  to: string;
  kind: LogicEdgeType;
  label?: string;
  location: string;
  confidence: number;
  /** Present for heuristically inferred edges. */
  inferredReason?: string;
}

export interface FlowAnalysisInput {
  question: string;
  repository: { name: string; files: number; frameworks: string[] };
  candidates: CandidateNodeInfo[];
  edges: CandidateEdgeInfo[];
  entryPointHints: string[];
  maxNodes: number;
}

export interface InferredEdgeProposal {
  from: string;
  to: string;
  kind: LogicEdgeType;
  label?: string;
  reason: string;
  confidence: number;
}

export interface FlowAnalysisResult {
  title: string;
  /** False when the candidates do not contain the requested flow. */
  answerable: boolean;
  entryPoints: string[];
  nodes: { ref: string; description?: string }[];
  inferredEdges: InferredEdgeProposal[];
  explanation?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * The semantic layer. Providers choose which candidates answer the question,
 * describe them and explain the flow. They never see the whole repository,
 * only the candidates static analysis produced.
 */
export interface LLMProvider {
  readonly id: string;
  readonly model?: string;
  /** Human-readable name for progress output, e.g. "Claude (claude-opus-5-5)". */
  readonly displayName: string;
  analyzeFlow(input: FlowAnalysisInput): Promise<FlowAnalysisResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
