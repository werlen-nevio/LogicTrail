import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/config.js";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "../src/llm/anthropic.js";
import { selectProvider } from "../src/llm/index.js";
import { buildUserPrompt, SYSTEM_PROMPT, type FlowSelection } from "../src/llm/prompt.js";
import { StaticProvider } from "../src/llm/static.js";
import {
  ProviderError,
  type FlowAnalysisInput,
  type FlowAnalysisResult,
  type LLMProvider,
} from "../src/llm/types.js";
import { validateSelection } from "../src/llm/validate.js";
import { analyze } from "../src/pipeline.js";
import type { CandidateGraph } from "../src/query/candidates.js";
import { ACME_SHOP } from "./helpers.js";

const input: FlowAnalysisInput = {
  question: "how does <login> work?",
  repository: { name: "shop", files: 3, frameworks: ["express"] },
  candidates: [
    {
      ref: "n1",
      id: "a#login",
      type: "function",
      label: "login()",
      file: "a.ts",
      line: 1,
      score: 3,
      role: "seed",
      details: [],
      snippet: "   1 export function login() {}",
    },
    {
      ref: "n2",
      id: "b#createSession",
      type: "function",
      label: "createSession()",
      file: "b.ts",
      line: 4,
      score: 1,
      role: "callee",
      details: ["env: SECRET"],
    },
  ],
  edges: [{ from: "n1", to: "n2", kind: "calls", location: "a.ts:2", confidence: 1 }],
  entryPointHints: ["n1"],
  maxNodes: 10,
};

const selection: FlowSelection = {
  title: "Login flow",
  answerable: true,
  entryPoints: ["n1"],
  nodes: [
    { ref: "n1", description: "Starts the login." },
    { ref: "n2", description: "Creates the session." },
  ],
  inferredEdges: [],
  explanation: "Login calls createSession.",
};

function fakeClient(
  message: Record<string, unknown>,
  capture?: (params: unknown) => void,
): Anthropic {
  return {
    beta: {
      messages: {
        stream: (params: unknown) => {
          capture?.(params);
          return { finalMessage: () => Promise.resolve(message) };
        },
      },
    },
  } as unknown as Anthropic;
}

const okMessage = {
  stop_reason: "end_turn",
  stop_details: null,
  parsed_output: selection,
  usage: { input_tokens: 1200, output_tokens: 300 },
};

describe("AnthropicProvider", () => {
  it("sends one structured-output request with adaptive thinking and refusal fallbacks", async () => {
    let params: Record<string, unknown> = {};
    const provider = new AnthropicProvider({
      client: fakeClient(okMessage, (p) => (params = p as Record<string, unknown>)),
    });
    const result = await provider.analyzeFlow(input);

    expect(params.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.system).toBe(SYSTEM_PROMPT);
    const outputConfig = params.output_config as {
      effort: string;
      format: { type: string; schema: { properties: Record<string, unknown> } };
    };
    expect(outputConfig.effort).toBe("medium");
    expect(outputConfig.format.type).toBe("json_schema");
    expect(Object.keys(outputConfig.format.schema.properties)).toEqual(
      expect.arrayContaining([
        "title",
        "answerable",
        "entryPoints",
        "nodes",
        "inferredEdges",
        "explanation",
      ]),
    );
    expect(result).toEqual({ ...selection, usage: { inputTokens: 1200, outputTokens: 300 } });
  });

  it("can disable fallbacks and change model and effort", async () => {
    let params: Record<string, unknown> = {};
    const provider = new AnthropicProvider({
      model: "claude-sonnet-5-5",
      effort: "low",
      fallbacks: false,
      client: fakeClient(okMessage, (p) => (params = p as Record<string, unknown>)),
    });
    await provider.analyzeFlow(input);
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
    expect((params.output_config as { effort: string }).effort).toBe("low");
  });

  it("turns refusals, truncation and transport failures into ProviderErrors", async () => {
    const refusal = new AnthropicProvider({
      client: fakeClient({
        ...okMessage,
        stop_reason: "refusal",
        stop_details: { category: "cyber" },
      }),
    });
    await expect(refusal.analyzeFlow(input)).rejects.toThrow(/declined.*cyber/);
    const truncated = new AnthropicProvider({
      client: fakeClient({ ...okMessage, stop_reason: "max_tokens" }),
    });
    await expect(truncated.analyzeFlow(input)).rejects.toBeInstanceOf(ProviderError);
    const unparsed = new AnthropicProvider({
      client: fakeClient({ ...okMessage, parsed_output: null }),
    });
    await expect(unparsed.analyzeFlow(input)).rejects.toThrow(/expected format/);
    const failing = {
      beta: {
        messages: {
          stream: () => ({ finalMessage: () => Promise.reject(new Error("socket hang up")) }),
        },
      },
    } as unknown as Anthropic;
    await expect(new AnthropicProvider({ client: failing }).analyzeFlow(input)).rejects.toThrow(
      /socket hang up/,
    );
  });
});

describe("prompt", () => {
  it("contains the question, candidates, excerpts and edges, with the question escaped", () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain("<question>how does &lt;login&gt; work?</question>");
    expect(prompt).toContain("n1 | function | login() | a.ts:1 | relevance 3 | seed");
    expect(prompt).toContain("   1 export function login() {}");
    expect(prompt).toContain("env: SECRET");
    expect(prompt).toContain("n1 -calls-> n2 (a.ts:2)");
    expect(prompt).toContain("<entry_point_hints>n1</entry_point_hints>");
  });
});

describe("validateSelection", () => {
  const refs = new Map([
    ["n1", "a#login"],
    ["n2", "b#createSession"],
    ["n3", "c#writeCookie"],
  ]);
  const candidates = {
    nodes: new Map(),
    edges: [
      {
        from: "a#login",
        to: "b#createSession",
        kind: "calls",
        file: "a.ts",
        line: 2,
        text: "",
        confidence: 1,
      },
    ],
    seeds: [],
    entryPoints: [],
  } as unknown as CandidateGraph;

  it("drops references to nodes static analysis never found", () => {
    const result: FlowAnalysisResult = {
      ...selection,
      nodes: [...selection.nodes, { ref: "n99", description: "hallucinated" }],
      entryPoints: ["n1", "n42"],
      inferredEdges: [
        { from: "n2", to: "n3", kind: "calls", label: "", reason: "not selected", confidence: 0.9 },
        {
          from: "n1",
          to: "n2",
          kind: "calls",
          label: "",
          reason: "already proven",
          confidence: 0.9,
        },
        {
          from: "n2",
          to: "n1",
          kind: "triggers",
          label: "callback",
          reason: "registered as a callback",
          confidence: 7,
        },
      ],
    };
    const validated = validateSelection(result, refs, candidates, 10);
    expect(validated.nodes).toEqual(["a#login", "b#createSession"]);
    expect(validated.entryPoints).toEqual(["a#login"]);
    expect(validated.descriptions.get("b#createSession")).toBe("Creates the session.");
    expect(validated.inferredEdges).toEqual([
      {
        from: "b#createSession",
        to: "a#login",
        kind: "triggers",
        label: "callback",
        reason: "registered as a callback",
        confidence: 0.95,
      },
    ]);
    expect(validated.warnings).toEqual([
      "Ignored 2 reference(s) to nodes that static analysis did not find.",
      "Dropped 1 inferred edge(s) that did not connect two selected nodes.",
    ]);
  });

  it("enforces the node budget", () => {
    const validated = validateSelection(selection, refs, candidates, 1);
    expect(validated.nodes).toEqual(["a#login"]);
    expect(validated.warnings[0]).toMatch(/keeping the first 1/);
  });
});

describe("selectProvider", () => {
  it("maps --model values to providers", () => {
    expect(selectProvider({ model: "static" }).provider).toBeInstanceOf(StaticProvider);
    expect(selectProvider({ model: "claude" }).provider.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(selectProvider({ model: "claude-sonnet-5-5" }).provider.model).toBe("claude-sonnet-5-5");
    expect(() => selectProvider({ model: "gpt-9" })).toThrow(ProviderError);
  });

  it("uses Claude automatically only when credentials are configured", () => {
    const none = selectProvider({ model: "auto", env: {} });
    expect(none.provider).toBeInstanceOf(StaticProvider);
    expect(none.notice).toMatch(/ANTHROPIC_API_KEY/);
    expect(
      selectProvider({ model: "auto", env: { ANTHROPIC_API_KEY: "test" } }).provider,
    ).toBeInstanceOf(AnthropicProvider);
  });
});

describe("pipeline with an LLM provider", () => {
  const config = resolveConfig({ cache: false });

  class ScriptedProvider implements LLMProvider {
    readonly id = "scripted";
    readonly model = "scripted-1";
    readonly displayName = "Scripted";
    received: FlowAnalysisInput | undefined;

    analyzeFlow(request: FlowAnalysisInput): Promise<FlowAnalysisResult> {
      this.received = request;
      const ref = (label: string): string => {
        const found = request.candidates.find((candidate) => candidate.label === label);
        if (!found) throw new Error(`candidate ${label} missing`);
        return found.ref;
      };
      return Promise.resolve({
        title: "Login flow",
        answerable: true,
        entryPoints: [ref("LoginForm")],
        nodes: [
          { ref: ref("LoginForm"), description: "Login form component." },
          { ref: ref("login()"), description: "Calls the login API." },
          { ref: ref("authController.login()"), description: "Checks the credentials." },
          { ref: ref("createSession()"), description: "Creates a session row." },
          { ref: "n999", description: "Not a real node." },
        ],
        inferredEdges: [
          {
            from: ref("createSession()"),
            to: ref("LoginForm"),
            kind: "triggers",
            label: "re-render",
            reason: "Session cookie changes UI state.",
            confidence: 0.4,
          },
        ],
        explanation:
          "The form posts credentials; the controller verifies them and creates a session.",
      });
    }
  }

  it("keeps the LLM's selection, connects it statically and labels inferred edges", async () => {
    const provider = new ScriptedProvider();
    const { graph } = await analyze({
      root: ACME_SHOP,
      question: "how does login work?",
      config,
      provider,
    });

    expect(provider.received?.candidates.length).toBeGreaterThan(10);
    expect(graph.analysis).toMatchObject({ provider: "scripted", model: "scripted-1" });
    expect(graph.title).toBe("Login flow");
    expect(graph.explanation).toBe(
      "The form posts credentials; the controller verifies them and creates a session.",
    );

    const labels = graph.nodes.map((node) => node.label);
    // Selected nodes plus the static path that connects them (handleSubmit, the route, ...).
    expect(labels).toEqual(
      expect.arrayContaining([
        "LoginForm",
        "handleSubmit()",
        "login()",
        "POST /api/auth/login",
        "authController.login()",
        "createSession()",
      ]),
    );
    expect(labels).not.toContain("LoginPage");
    expect(graph.analysis.warnings).toContain(
      "Ignored 1 reference(s) to nodes that static analysis did not find.",
    );

    const login = graph.nodes.find((node) => node.label === "login()");
    expect(login).toMatchObject({ description: "Calls the login API.", descriptionSource: "llm" });
    const inferred = graph.edges.find((edge) => edge.source === "inferred");
    expect(inferred).toMatchObject({
      type: "triggers",
      confidence: 0.4,
      reason: "Session cookie changes UI state.",
      evidence: [],
    });
  });

  it("falls back to static analysis when the provider fails", async () => {
    const failing: LLMProvider = {
      id: "anthropic",
      displayName: "Claude (test)",
      analyzeFlow: () => Promise.reject(new ProviderError("Claude rejected the credentials.")),
    };
    const { graph, provider } = await analyze({
      root: ACME_SHOP,
      question: "how does login work?",
      config,
      provider: failing,
    });
    expect(provider).toBeInstanceOf(StaticProvider);
    expect(graph.analysis.provider).toBe("static");
    expect(graph.analysis.warnings[0]).toMatch(/Claude \(test\) was unavailable/);
    expect(graph.nodes.length).toBeGreaterThan(10);
  });
});
