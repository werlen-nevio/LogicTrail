import type { FlowAnalysisInput, FlowAnalysisResult, LLMProvider } from "./types.js";

/**
 * Deterministic provider used when no LLM is configured (or requested with
 * --model static). It keeps the candidate sub-graph as selected by static
 * analysis; descriptions and the explanation are generated from code facts.
 */
export class StaticProvider implements LLMProvider {
  readonly id = "static";
  readonly displayName = "static analysis (no LLM)";

  analyzeFlow(input: FlowAnalysisInput): Promise<FlowAnalysisResult> {
    const selected = input.candidates.slice(0, input.maxNodes);
    return Promise.resolve({
      title: titleFromQuestion(input.question),
      answerable: selected.length > 0,
      entryPoints: input.entryPointHints,
      nodes: selected.map((candidate) => ({ ref: candidate.ref })),
      inferredEdges: [],
    });
  }
}

export function titleFromQuestion(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Flow";
  return trimmed[0]?.toUpperCase() + trimmed.slice(1);
}
