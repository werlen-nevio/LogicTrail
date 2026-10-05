import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL, type Effort } from "./anthropic.js";
import { StaticProvider } from "./static.js";
import { ProviderError, type LLMProvider } from "./types.js";

export interface ProviderSettings {
  /**
   * What to use: "auto" (Claude when credentials are present, otherwise
   * static), "claude"/"anthropic", a Claude model id such as
   * "claude-opus-5-5", or "static"/"none".
   */
  model?: string;
  effort?: Effort;
  fallbacks?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface ProviderSelection {
  provider: LLMProvider;
  /** Explains an automatic choice, e.g. why no LLM is used. */
  notice?: string;
}

const STATIC_NAMES = new Set(["static", "none", "off", "false", "no-llm"]);
const CLAUDE_NAMES = new Set(["claude", "anthropic"]);

export function selectProvider(settings: ProviderSettings = {}): ProviderSelection {
  const env = settings.env ?? process.env;
  const requested = settings.model?.trim() || "auto";
  const name = requested.toLowerCase();
  const claudeOptions = {
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.fallbacks !== undefined ? { fallbacks: settings.fallbacks } : {}),
  };

  if (STATIC_NAMES.has(name)) return { provider: new StaticProvider() };
  if (CLAUDE_NAMES.has(name)) {
    return {
      provider: new AnthropicProvider({ model: DEFAULT_ANTHROPIC_MODEL, ...claudeOptions }),
    };
  }
  if (name.startsWith("claude-"))
    return { provider: new AnthropicProvider({ model: requested, ...claudeOptions }) };
  if (name === "auto") {
    if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) {
      return { provider: new AnthropicProvider(claudeOptions) };
    }
    return {
      provider: new StaticProvider(),
      notice:
        "No ANTHROPIC_API_KEY found: using static analysis only. Set it (or pass --model claude) for AI selection and explanations.",
    };
  }
  throw new ProviderError(
    `Unknown model "${requested}".`,
    'Use "claude", a Claude model id like "claude-opus-5-5", or "static".',
  );
}

export { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL, StaticProvider };
export type { Effort, LLMProvider };
