import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { buildUserPrompt, FlowSelectionSchema, SYSTEM_PROMPT } from "./prompt.js";
import {
  ProviderError,
  type FlowAnalysisInput,
  type FlowAnalysisResult,
  type LLMProvider,
} from "./types.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicProviderOptions {
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  /** Server-side refusal fallback (Claude API only). Defaults to true. */
  fallbacks?: boolean;
  /** Injected client, used by tests and custom setups (proxies, Bedrock, ...). */
  client?: Anthropic;
}

/**
 * LLMProvider backed by Claude. One structured-output request per question:
 * Claude selects nodes from the static candidates, describes them and
 * explains the flow. The response is validated against a Zod schema.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly model: string;
  readonly displayName: string;
  private readonly effort: Effort;
  private readonly maxTokens: number;
  private readonly fallbacks: boolean;
  private client: Anthropic | undefined;

  constructor(options: AnthropicProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.displayName = `Claude (${this.model})`;
    this.effort = options.effort ?? "medium";
    this.maxTokens = options.maxTokens ?? 32_000;
    this.fallbacks = options.fallbacks ?? true;
    this.client = options.client;
  }

  async analyzeFlow(input: FlowAnalysisInput): Promise<FlowAnalysisResult> {
    const client = (this.client ??= new Anthropic());
    let message;
    try {
      const stream = client.beta.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        ...(this.fallbacks
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
        thinking: { type: "adaptive" },
        output_config: { effort: this.effort, format: betaZodOutputFormat(FlowSelectionSchema) },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      });
      message = await stream.finalMessage();
    } catch (error) {
      throw toProviderError(error);
    }

    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category;
      throw new ProviderError(
        `Claude declined to analyze this flow${category ? ` (${category})` : ""}.`,
        "Rephrase the question or run with --model static.",
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new ProviderError(
        "Claude's response was cut off before it was complete.",
        "Ask about a narrower flow or lower --max-nodes.",
      );
    }
    const parsed = message.parsed_output;
    if (!parsed) {
      throw new ProviderError(
        "Claude returned a response that does not match the expected format.",
      );
    }
    return {
      title: parsed.title,
      answerable: parsed.answerable,
      entryPoints: parsed.entryPoints,
      nodes: parsed.nodes,
      inferredEdges: parsed.inferredEdges,
      explanation: parsed.explanation,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError(
      "Claude rejected the credentials.",
      "Set ANTHROPIC_API_KEY (or log in with `ant auth login`), or run with --model static.",
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError(
      "This API key is not allowed to use the requested model.",
      "Pick another model with --model.",
    );
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new ProviderError(
      "The requested Claude model was not found.",
      "Check the model id passed to --model.",
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError("Claude rate limit reached.", "Wait a moment and try again.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ProviderError(`Claude rejected the request: ${error.message}`);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError(
      "Could not reach the Claude API.",
      "Check your network connection or proxy settings.",
    );
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(
      `Claude API error${error.status ? ` ${error.status}` : ""}: ${error.message}`,
    );
  }
  if (error instanceof Anthropic.AnthropicError) {
    return new ProviderError(`Claude request failed: ${error.message}`);
  }
  return new ProviderError(`Claude request failed: ${(error as Error).message ?? String(error)}`);
}
