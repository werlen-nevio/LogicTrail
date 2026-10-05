import type { CodeGraph, CodeNode } from "../analysis/code-graph.js";
import type { CandidateGraph } from "../query/candidates.js";
import type { SourceReader } from "../source.js";
import type { CandidateEdgeInfo, CandidateNodeInfo, FlowAnalysisInput } from "./types.js";
import { asText } from "../util/text.js";

export interface InputBudget {
  /** Total characters of source excerpts included in the prompt. */
  snippetChars: number;
  /** Maximum lines per excerpt. */
  snippetLines: number;
}

const DEFAULT_BUDGET: InputBudget = { snippetChars: 60_000, snippetLines: 40 };

export interface BuiltInput {
  input: FlowAnalysisInput;
  /** ref -> code graph id */
  refs: Map<string, string>;
}

/**
 * Converts the candidate sub-graph into a compact, provider-neutral input.
 * Source excerpts are included for the most relevant symbols until the
 * budget is used up; the rest are described by signature only.
 */
export function buildFlowAnalysisInput(options: {
  question: string;
  repositoryName: string;
  fileCount: number;
  graph: CodeGraph;
  candidates: CandidateGraph;
  source: SourceReader;
  maxNodes: number;
  budget?: Partial<InputBudget>;
}): BuiltInput {
  const budget = { ...DEFAULT_BUDGET, ...options.budget };
  const { graph, candidates } = options;

  const ordered = [...candidates.nodes.values()].sort(
    (a, b) =>
      roleRank(a.role) - roleRank(b.role) ||
      Math.abs(a.depth) - Math.abs(b.depth) ||
      b.score - a.score,
  );
  const refs = new Map<string, string>();
  const refOf = new Map<string, string>();
  ordered.forEach((candidate, index) => {
    const ref = `n${index + 1}`;
    refs.set(ref, candidate.id);
    refOf.set(candidate.id, ref);
  });

  // Excerpts go to the most relevant symbols first.
  const excerptOrder = [...ordered].sort(
    (a, b) => b.score - a.score || Math.abs(a.depth) - Math.abs(b.depth),
  );
  const excerpts = new Map<string, string>();
  let used = 0;
  for (const candidate of excerptOrder) {
    const node = graph.nodes.get(candidate.id);
    if (node?.kind !== "symbol" || !node.file || !node.line) continue;
    const snippet = options.source.snippet(
      node.file,
      node.line,
      node.endLine ?? node.line,
      budget.snippetLines,
    );
    if (!snippet) continue;
    const text = snippet.lines
      .map((line, offset) => `${String(snippet.startLine + offset).padStart(4)} ${line}`)
      .join("\n")
      .concat(snippet.truncated ? "\n     …" : "");
    if (used + text.length > budget.snippetChars) continue;
    used += text.length;
    excerpts.set(candidate.id, text);
  }

  const nodes: CandidateNodeInfo[] = ordered.flatMap((candidate) => {
    const node = graph.nodes.get(candidate.id);
    const ref = refOf.get(candidate.id);
    if (!node || !ref) return [];
    const excerpt = excerpts.get(candidate.id);
    const info: CandidateNodeInfo = {
      ref,
      id: node.id,
      type: node.type,
      label: node.label,
      score: Math.round(candidate.score * 100) / 100,
      role: candidate.role,
      details: describeDetails(node),
      ...(node.file ? { file: node.file } : {}),
      ...(node.line ? { line: node.line } : {}),
      ...(node.symbol?.signature ? { signature: node.symbol.signature } : {}),
      ...(node.symbol?.doc ? { doc: node.symbol.doc } : {}),
      ...(excerpt ? { snippet: excerpt } : {}),
    };
    return [info];
  });

  const edges: CandidateEdgeInfo[] = candidates.edges.flatMap((edge) => {
    const from = refOf.get(edge.from);
    const to = refOf.get(edge.to);
    if (!from || !to) return [];
    return [
      {
        from,
        to,
        kind: edge.kind,
        location: `${edge.file}:${edge.line}`,
        confidence: edge.confidence,
        ...(edge.label ? { label: edge.label } : {}),
        ...(edge.inferred ? { inferredReason: edge.inferred.reason } : {}),
      },
    ];
  });

  return {
    refs,
    input: {
      question: options.question,
      repository: {
        name: options.repositoryName,
        files: options.fileCount,
        frameworks: [...graph.frameworks].sort(),
      },
      candidates: nodes,
      edges,
      entryPointHints: candidates.entryPoints.flatMap((id) => refOf.get(id) ?? []),
      maxNodes: options.maxNodes,
    },
  };
}

function roleRank(role: string): number {
  return role === "seed" ? 0 : role === "caller" ? 1 : 2;
}

function describeDetails(node: CodeNode): string[] {
  const details: string[] = [];
  const metadata = node.metadata;
  const pages = metadata.pages as string[] | undefined;
  if (pages?.length) details.push(`page: ${pages.join(", ")}`);
  if (node.kind === "database") {
    details.push(
      `${asText(metadata.system)} ${asText(metadata.access)} (${asText(metadata.operation)})`,
    );
  }
  if (node.kind === "external" && metadata.service)
    details.push(`service: ${asText(metadata.service)}`);
  if (node.kind === "library" && metadata.category)
    details.push(`library: ${asText(metadata.category)}`);
  if (node.kind === "event") details.push(`${asText(metadata.channel)}: ${asText(metadata.event)}`);
  if (node.kind === "route" && metadata.framework)
    details.push(`framework: ${asText(metadata.framework)}`);
  const envVars = metadata.envVars as string[] | undefined;
  if (envVars?.length) details.push(`env: ${envVars.join(", ")}`);
  return details;
}
