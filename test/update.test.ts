import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/config.js";
import { diffFlows, hasChanges } from "../src/flow/diff.js";
import type { LogicEdge, LogicNode, LogicTrailGraph } from "../src/graph/model.js";
import { StaticProvider } from "../src/llm/static.js";
import { writeOutputs } from "../src/output.js";
import { analyze } from "../src/pipeline.js";
import { findSavedFlows, updateFlow } from "../src/update.js";
import { ACME_SHOP } from "./helpers.js";

const config = resolveConfig({ cache: false });

function node(type: LogicNode["type"], label: string, file: string, line: number): LogicNode {
  return { id: `${type}:${file}:${line}`, type, label, file, line };
}

function edge(from: LogicNode, to: LogicNode, extra: Partial<LogicEdge> = {}): LogicEdge {
  return {
    id: `${from.id}>${to.id}`,
    from: from.id,
    to: to.id,
    type: "calls",
    confidence: 1,
    source: "static",
    ...extra,
  };
}

function graph(nodes: LogicNode[], edges: LogicEdge[]): LogicTrailGraph {
  return {
    schemaVersion: 1,
    query: "q",
    title: "Q",
    entryPoints: nodes[0] ? [nodes[0].id] : [],
    nodes,
    edges,
    explanation: "",
    analysis: {
      provider: "static",
      generatedAt: "2026-10-05T00:00:00.000Z",
      repository: "r",
      stats: { files: 1, symbols: 1, relationships: 1, candidates: 1 },
      warnings: [],
    },
  };
}

describe("diffFlows", () => {
  const route = node("route", "POST /api/orders", "routes.ts", 4);
  const create = node("function", "create()", "orders.ts", 10);
  const write = node("database", "order.create", "orders.ts", 12);
  const before = graph([route, create, write], [edge(route, create), edge(create, write)]);

  it("reports nothing for the same flow", () => {
    expect(hasChanges(diffFlows(before, before))).toBe(false);
  });

  it("treats a step whose line shifted as moved, not as removed and added", () => {
    const create2 = node("function", "create()", "orders.ts", 14);
    const write2 = node("database", "order.create", "orders.ts", 16);
    const after = graph([route, create2, write2], [edge(route, create2), edge(create2, write2)]);
    const changes = diffFlows(before, after);
    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual([]);
    expect(changes.moved.map((moved) => [moved.node.label, moved.from])).toEqual([
      ["create()", "orders.ts:10"],
      ["order.create", "orders.ts:12"],
    ]);
    expect(changes.addedEdges).toEqual([]);
    expect(changes.removedEdges).toEqual([]);
  });

  it("reports added and removed steps and edges", () => {
    const audit = node("database", "audit.create", "orders.ts", 13);
    const after = graph(
      [route, create, audit],
      [edge(route, create), edge(create, audit, { type: "writes" })],
    );
    const changes = diffFlows(before, after);
    expect(changes.added.map((added) => added.label)).toEqual(["audit.create"]);
    expect(changes.removed.map((removed) => removed.label)).toEqual(["order.create"]);
    const ends = (list: typeof changes.addedEdges) =>
      list.map((change) => [change.from.label, change.to.label, change.betweenKeptSteps]);
    // Both edges follow from the added and removed steps.
    expect(ends(changes.addedEdges)).toEqual([["create()", "audit.create", false]]);
    expect(ends(changes.removedEdges)).toEqual([["create()", "order.create", false]]);
  });

  it("marks connections gained or lost between steps that are in both versions", () => {
    const after = graph([route, create, write], [edge(route, create), edge(route, write)]);
    const changes = diffFlows(before, after);
    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual([]);
    expect(changes.addedEdges.map((change) => change.betweenKeptSteps)).toEqual([true]);
    expect(changes.removedEdges.map((change) => [change.from.label, change.to.label])).toEqual([
      ["create()", "order.create"],
    ]);
    expect(changes.removedEdges[0]?.betweenKeptSteps).toBe(true);
  });

  it("follows a step into another file when that is unambiguous", () => {
    const moved = node("function", "create()", "services/orders.ts", 3);
    const after = graph([route, moved, write], [edge(route, moved), edge(moved, write)]);
    const changes = diffFlows(before, after);
    expect(changes.moved.map((item) => item.from)).toEqual(["orders.ts:10"]);
    expect(changes.added).toEqual([]);
    expect(changes.addedEdges).toEqual([]);
  });
});

describe("updateFlow", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "logictrail-update-"));
    await fs.cp(ACME_SHOP, root, {
      recursive: true,
      filter: (source) => !/[\\/](\.logictrail|node_modules)$/.test(source),
    });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("re-runs a saved flow from its request and reports what changed in the code", async () => {
    const outDir = path.join(root, ".logictrail");
    const { graph: first } = await analyze({
      root,
      question: "what happens when a payment fails?",
      config,
      provider: new StaticProvider(),
    });
    expect(first.request).toEqual({
      question: "what happens when a payment fails?",
      maxDepth: 12,
      maxNodes: 60,
    });
    await writeOutputs(first, { outDir, name: "payment", formats: ["json", "svg"], theme: "dark" });

    const file = path.join(root, "server/src/services/orderService.ts");
    const source = await fs.readFile(file, "utf8");
    await fs.writeFile(
      file,
      `// shifted\n// shifted\n${source.replace(
        "  await releaseInventory(orderId);\n",
        "  await releaseInventory(orderId);\n  await db.paymentAttempt.create({ data: { orderId } });\n",
      )}`,
    );

    const { flows, problems } = await findSavedFlows(outDir);
    expect(problems).toEqual([]);
    expect(flows.map((flow) => [flow.name, flow.formats, flow.theme])).toEqual([
      ["payment", ["svg", "json"], "dark"],
    ]);
    const [saved] = flows;
    if (!saved) throw new Error("no saved flow");
    const result = await updateFlow(saved, { root, config, provider: new StaticProvider() });

    expect(result.changes.added.map((added) => added.label)).toEqual(["paymentAttempt.create"]);
    expect(result.changes.removed).toEqual([]);
    expect(result.changes.moved.map((moved) => moved.node.label)).toContain("markOrderFailed()");
    expect(result.written.map((written) => path.basename(written.path))).toEqual([
      "payment.svg",
      "payment.json",
    ]);
    expect(await fs.readFile(path.join(outDir, "payment.svg"), "utf8")).toContain(
      'data-theme="dark"',
    );
  });

  it("updates flows saved as HTML only, and flows without a request", async () => {
    const outDir = path.join(root, ".logictrail");
    const { graph: byRoute } = await analyze({
      root,
      target: { route: "POST /api/orders" },
      config,
      provider: new StaticProvider(),
    });
    expect(byRoute.request).toEqual({ route: "POST /api/orders", maxDepth: 12, maxNodes: 60 });
    await writeOutputs(byRoute, { outDir, name: "orders", formats: ["html"] });
    // A flow written before `update` existed: no request, only the question it shows.
    const { request: _request, ...legacy } = byRoute;
    await writeOutputs(
      { ...legacy, query: "how does checkout work?" },
      { outDir, name: "legacy", formats: ["json"] },
    );

    const { flows } = await findSavedFlows(outDir);
    expect(flows.map((flow) => flow.name)).toEqual(["legacy", "orders"]);
    for (const flow of flows) {
      const result = await updateFlow(flow, { root, config, provider: new StaticProvider() });
      expect(result.graph.nodes.length).toBeGreaterThan(0);
    }
    const [legacyFlow] = (await findSavedFlows(outDir, ["legacy"])).flows;
    expect(legacyFlow?.graph.request?.question).toBe("how does checkout work?");
  });

  it("explains names it can't find", async () => {
    const { flows, problems } = await findSavedFlows(path.join(root, ".logictrail"), ["nope"]);
    expect(flows).toEqual([]);
    expect(problems[0]).toMatch(/^No saved flow named "nope"/);
  });
});
