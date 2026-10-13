import { describe, expect, it } from "vitest";
import { buildCodeGraph, type CodeGraph } from "../src/analysis/code-graph.js";
import { Workspace } from "../src/analysis/workspace.js";
import { chooseSeeds, extractCandidates } from "../src/query/candidates.js";
import { RetrievalIndex } from "../src/query/retrieve.js";
import { queryTerms } from "../src/query/terms.js";
import { facts } from "./helpers.js";

function graphOf(files: Record<string, string>): CodeGraph {
  return buildCodeGraph(
    new Workspace(
      Object.entries(files).map(([file, code]) => facts(code, file)),
      "/repo",
    ),
  );
}

function seedLabels(graph: CodeGraph, question: string, limit = 12): string[] {
  const scored = new RetrievalIndex(graph).score(queryTerms(question));
  return chooseSeeds(graph, scored, { limit, ratio: 0.45, maxDepth: 6 }).map(
    (id) => graph.nodes.get(id)?.label ?? id,
  );
}

describe("seeds", () => {
  it("prefer matches that cover more of the question", () => {
    const graph = graphOf({
      "src/articles.ts": `export async function createArticle(input) { return input; }`,
      "src/users.ts": `export async function createUser(input) { return input; }`,
    });
    expect(seedLabels(graph, "what happens when an article is created?")).toEqual([
      "createArticle()",
    ]);
  });

  it("count near-identical versioned symbols once and skip what another seed reaches", () => {
    const graph = graphOf({
      "src/slots/2024-04-15/slots.controller.ts": `
        export class SlotsController_2024_04_15 { getAvailableSlots() { return 1; } }
      `,
      "src/slots/2024-09-04/slots.controller.ts": `
        export class SlotsController_2024_09_04 { getAvailableSlots() { return 2; } }
      `,
      "src/slots/util.ts": `
        export function getAvailableSlots() { return computeAvailableSlots(); }
        export function computeAvailableSlots() { return []; }
      `,
    });
    const seeds = seedLabels(graph, "available slots");
    expect(seeds).toContain("getAvailableSlots()");
    // getAvailableSlots() reaches it, so it is no seed of its own.
    expect(seeds).not.toContain("computeAvailableSlots()");
    expect(seeds.filter((label) => label.startsWith("SlotsController"))).toHaveLength(1);
  });

  it("rank tests and mocks below the code they exercise", () => {
    const graph = graphOf({
      "src/signup.ts": `export function signupUser() { return 1; }`,
      "src/__tests__/signup.test.ts": `export function signupUserForTest() { return signupUser(); }`,
    });
    expect(seedLabels(graph, "how does signup work?")).toEqual(["signupUser()"]);
  });
});

describe("candidates", () => {
  it("keep the path to relevant code over leaves when the budget is small", () => {
    const graph = graphOf({
      "src/checkout.ts": `
        export function checkout() { log(); format(); trace(); return chargePayment(); }
        function chargePayment() { return capturePayment(); }
        function capturePayment() { return 1; }
        function log() {}
        function format() {}
        function trace() {}
      `,
    });
    const scored = new RetrievalIndex(graph).score(queryTerms("how is the payment charged?"));
    const scores = new Map(scored.map((node) => [node.id, node.score]));
    const seed = [...graph.nodes.values()].find((node) => node.label === "checkout()")?.id ?? "";
    const candidates = extractCandidates(graph, scores, [seed], {
      maxDepth: 4,
      maxCandidates: 3,
      upDepth: 2,
    });
    expect([...candidates.nodes.keys()].map((id) => graph.nodes.get(id)?.label)).toEqual([
      "checkout()",
      "chargePayment()",
      "capturePayment()",
    ]);
  });
});
