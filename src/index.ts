/**
 * LogicTrail public API.
 *
 * ```ts
 * import { analyze, writeOutputs } from "logictrail";
 *
 * const { graph } = await analyze({ root: ".", question: "how does checkout work?" });
 * await writeOutputs(graph, { outDir: ".logictrail", name: "checkout", formats: ["html", "mermaid"] });
 * ```
 */
export {
  analyze,
  buildFlowPrompt,
  indexAndAnalyze,
  NoFlowFoundError,
  questionForTarget,
  seedsForTarget,
} from "./pipeline.js";
export type {
  AnalysisResult,
  AnalyzeOptions,
  FlowPrompt,
  FlowTarget,
  IndexedRepository,
} from "./pipeline.js";
export { writeOutputs, renderFormat, slugify } from "./output.js";
export type { WriteOutputsOptions, WrittenFile } from "./output.js";
export { findSavedFlows, loadSavedFlow, SavedFlowError, updateFlow } from "./update.js";
export type { SavedFlow, UpdatedFlow, UpdateFlowOptions } from "./update.js";
export { diffFlows, hasChanges } from "./flow/diff.js";
export type { ChangedEdge, FlowChanges, MovedNode } from "./flow/diff.js";

export { defineConfig, DEFAULT_CONFIG, OUTPUT_FORMATS, resolveConfig } from "./config/config.js";
export type { LogicTrailConfig, OutputFormat, ResolvedConfig } from "./config/config.js";
export { loadConfig, ConfigError } from "./config/load.js";

export * from "./graph/model.js";

export { indexRepository } from "./indexer/indexer.js";
export type { IndexOptions, IndexResult } from "./indexer/indexer.js";
export type * from "./indexer/facts.js";
export type { LanguageAdapter, ModuleResolver, ModuleResolution } from "./lang/adapter.js";
export { languageAdapters } from "./lang/registry.js";
export { javascriptAdapter } from "./lang/javascript/index.js";

export { Workspace } from "./analysis/workspace.js";
export { buildCodeGraph, CodeGraph } from "./analysis/code-graph.js";
export type { CodeEdge, CodeNode, ResolvedStep } from "./analysis/code-graph.js";
export { frameworkAdapters } from "./analysis/adapters/index.js";
export type {
  CallSiteContext,
  Classification,
  FrameworkAdapter,
} from "./analysis/adapters/index.js";

export {
  AnthropicProvider,
  DEFAULT_ANTHROPIC_MODEL,
  selectProvider,
  StaticProvider,
} from "./llm/index.js";
export type { Effort } from "./llm/index.js";
export { ProviderError } from "./llm/types.js";
export type { FlowAnalysisInput, FlowAnalysisResult, LLMProvider } from "./llm/types.js";

export { renderHtml } from "./render/html.js";
export { renderSvg } from "./render/svg.js";
export { renderMermaid } from "./render/mermaid.js";
export { renderJson } from "./render/json.js";
export { layoutGraph } from "./render/layout.js";

export type { Reporter } from "./reporter.js";
export { VERSION } from "./version.js";
