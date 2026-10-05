import type { LogicEdgeType } from "../graph/model.js";
import type { CandidateGraph } from "../query/candidates.js";
import type { FlowAnalysisResult } from "./types.js";

export interface SelectedInferredEdge {
  from: string;
  to: string;
  kind: LogicEdgeType;
  label?: string;
  reason: string;
  confidence: number;
}

export interface ValidatedSelection {
  title: string;
  answerable: boolean;
  /** Code graph ids, in the provider's order. */
  nodes: string[];
  entryPoints: string[];
  descriptions: Map<string, string>;
  inferredEdges: SelectedInferredEdge[];
  explanation?: string;
  warnings: string[];
}

/**
 * Checks a provider's answer against the candidates. Anything that does not
 * reference a real candidate is dropped, so an LLM cannot add nodes or
 * relationships that static analysis did not surface.
 */
export function validateSelection(
  result: FlowAnalysisResult,
  refs: ReadonlyMap<string, string>,
  candidates: CandidateGraph,
  maxNodes: number,
): ValidatedSelection {
  const warnings: string[] = [];
  const unknownRefs = new Set<string>();
  const resolve = (ref: string): string | undefined => {
    const id = refs.get(ref.trim());
    if (!id) unknownRefs.add(ref);
    return id;
  };

  const nodes: string[] = [];
  const descriptions = new Map<string, string>();
  for (const entry of result.nodes) {
    const id = resolve(entry.ref);
    if (!id || nodes.includes(id)) continue;
    nodes.push(id);
    const description = entry.description?.trim();
    if (description) descriptions.set(id, description);
  }
  if (nodes.length > maxNodes) {
    warnings.push(`The model selected ${nodes.length} nodes; keeping the first ${maxNodes}.`);
    nodes.length = maxNodes;
  }
  const selected = new Set(nodes);

  const entryPoints = result.entryPoints
    .map((ref) => resolve(ref))
    .filter((id): id is string => id !== undefined && selected.has(id));

  const staticPairs = new Set(candidates.edges.map((edge) => `${edge.from}\0${edge.to}`));
  const inferredEdges: SelectedInferredEdge[] = [];
  let droppedEdges = 0;
  for (const proposal of result.inferredEdges) {
    const from = resolve(proposal.from);
    const to = resolve(proposal.to);
    if (!from || !to || from === to || !selected.has(from) || !selected.has(to)) {
      droppedEdges++;
      continue;
    }
    if (staticPairs.has(`${from}\0${to}`)) continue;
    const confidence = Number.isFinite(proposal.confidence) ? proposal.confidence : 0.5;
    inferredEdges.push({
      from,
      to,
      kind: proposal.kind,
      reason: proposal.reason.trim() || "Inferred by the model.",
      confidence: Math.min(0.95, Math.max(0.05, confidence)),
      ...(proposal.label?.trim() ? { label: proposal.label.trim() } : {}),
    });
  }

  if (unknownRefs.size > 0) {
    warnings.push(
      `Ignored ${unknownRefs.size} reference(s) to nodes that static analysis did not find.`,
    );
  }
  if (droppedEdges > 0) {
    warnings.push(
      `Dropped ${droppedEdges} inferred edge(s) that did not connect two selected nodes.`,
    );
  }

  return {
    title: result.title.trim() || "Flow",
    answerable: result.answerable,
    nodes,
    entryPoints,
    descriptions,
    inferredEdges,
    ...(result.explanation?.trim() ? { explanation: result.explanation.trim() } : {}),
    warnings,
  };
}
