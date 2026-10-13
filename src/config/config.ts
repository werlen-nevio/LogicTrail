import { z } from "zod";
import { DEFAULT_EDITOR, editorProblem } from "../graph/editor.js";

export const OUTPUT_FORMATS = ["html", "svg", "mermaid", "json"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const ConfigSchema = z
  .object({
    /** Extra gitignore-style patterns to skip, relative to the repository root. */
    ignore: z.array(z.string()).optional(),
    /** Maximum hops followed downstream from the most relevant code. */
    maxDepth: z.number().int().min(1).max(50).optional(),
    /** Upper bound on nodes in the generated flow. */
    maxNodes: z.number().int().min(5).max(500).optional(),
    /** Where generated flows are written. */
    outputDir: z.string().min(1).optional(),
    /** Default output formats. */
    output: z.array(z.enum(OUTPUT_FORMATS)).min(1).optional(),
    /** Cache per-file analysis between runs. */
    cache: z.boolean().optional(),
    cacheDir: z.string().min(1).optional(),
    /**
     * Where "Open in editor" links in the HTML viewer go: "vscode" (default), "vscode-insiders",
     * "vscodium", "cursor", "idea", "none", or a URL template with {file} or {path} and {line}.
     */
    editor: z
      .string()
      .min(1)
      .superRefine((value, context) => {
        const problem = editorProblem(value);
        if (problem) context.addIssue({ code: "custom", message: problem });
      })
      .optional(),
    llm: z
      .object({
        /** "auto", "claude", a Claude model id, or "static". */
        model: z.string().min(1).optional(),
        effort: EffortSchema.optional(),
        /** Server-side refusal fallbacks (Claude API only). */
        fallbacks: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type LogicTrailConfig = z.infer<typeof ConfigSchema>;

export interface ResolvedConfig {
  ignore: string[];
  maxDepth: number;
  maxNodes: number;
  outputDir: string;
  output: OutputFormat[];
  cache: boolean;
  cacheDir: string;
  editor: string;
  llm: { model: string; effort?: z.infer<typeof EffortSchema>; fallbacks?: boolean };
  /** The config file that was loaded, if any. */
  configFile?: string;
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  ignore: [],
  maxDepth: 12,
  maxNodes: 60,
  outputDir: ".logictrail",
  output: ["html"],
  cache: true,
  cacheDir: ".logictrail/cache",
  editor: DEFAULT_EDITOR,
  llm: { model: "auto" },
};

/** Identity helper that gives `logictrail.config.ts` files type checking. */
export function defineConfig(config: LogicTrailConfig): LogicTrailConfig {
  return config;
}

export function resolveConfig(config: LogicTrailConfig, configFile?: string): ResolvedConfig {
  return {
    ignore: config.ignore ?? DEFAULT_CONFIG.ignore,
    maxDepth: config.maxDepth ?? DEFAULT_CONFIG.maxDepth,
    maxNodes: config.maxNodes ?? DEFAULT_CONFIG.maxNodes,
    outputDir: config.outputDir ?? DEFAULT_CONFIG.outputDir,
    output: config.output ?? DEFAULT_CONFIG.output,
    cache: config.cache ?? DEFAULT_CONFIG.cache,
    cacheDir: config.cacheDir ?? DEFAULT_CONFIG.cacheDir,
    editor: config.editor ?? DEFAULT_CONFIG.editor,
    llm: {
      model: config.llm?.model ?? DEFAULT_CONFIG.llm.model,
      ...(config.llm?.effort ? { effort: config.llm.effort } : {}),
      ...(config.llm?.fallbacks !== undefined ? { fallbacks: config.llm.fallbacks } : {}),
    },
    ...(configFile ? { configFile } : {}),
  };
}
