import fs from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/config.js";
import { GRAPH_SCHEMA_URL, type LogicTrailGraph } from "../src/graph/model.js";
import { StaticProvider } from "../src/llm/static.js";
import { analyze } from "../src/pipeline.js";
import { renderHtml, safeJson } from "../src/render/html.js";
import { renderJson } from "../src/render/json.js";
import { curvePath, layoutGraph, truncatePath } from "../src/render/layout.js";
import { escapeLabel, renderMermaid } from "../src/render/mermaid.js";
import { renderSvg } from "../src/render/svg.js";
import { ACME_SHOP, ROOT } from "./helpers.js";

let graph: LogicTrailGraph;

beforeAll(async () => {
  const result = await analyze({
    root: ACME_SHOP,
    question: "how does login work?",
    config: resolveConfig({ cache: false }),
    provider: new StaticProvider(),
  });
  graph = result.graph;
});

describe("layout", () => {
  it("places every node and routes every edge without overlaps", () => {
    const layout = layoutGraph(graph);
    expect(layout.nodes).toHaveLength(graph.nodes.length);
    expect(layout.edges).toHaveLength(graph.edges.length);
    for (const edge of layout.edges) expect(edge.path).toMatch(/^M[\d.-]+,[\d.-]+/);
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        if (!a || !b) continue;
        const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2;
        const overlapY = Math.abs(a.y - b.y) < (a.height + b.height) / 2;
        expect(overlapX && overlapY, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it("draws smooth curves through the dagre points", () => {
    expect(
      curvePath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toBe("M0,0 L10,10");
    expect(
      curvePath([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 20 },
      ]),
    ).toMatch(/^M0,0 L0,1\.7 C/);
  });

  it("shortens long paths from the left", () => {
    expect(truncatePath("server/src/controllers/authController.ts:9", 30)).toBe(
      "…/authController.ts:9",
    );
  });
});

describe("mermaid", () => {
  it("renders a flowchart with shapes, branches and locations", () => {
    const mermaid = renderMermaid(graph);
    expect(mermaid.split("\n")[1]).toBe("flowchart TD");
    expect(mermaid).toContain('"LoginPage<br/><small>client/src/pages/LoginPage.tsx:5</small>"');
    expect(mermaid).toMatch(/n\d+\[\("user\.findUnique<br\/>/);
    expect(mermaid).toMatch(/n\d+\{"!user"\}/);
    expect(mermaid).toMatch(/n\d+ -->\|"yes"\| n\d+/);
    expect(mermaid).toMatch(/n\d+ ==> n\d+/);
    expect(mermaid).toContain("classDef condition");
  });

  it("escapes characters that break Mermaid labels", () => {
    expect(escapeLabel('a "b" <c> | d')).toBe("a #quot;b#quot; #lt;c#gt; #124; d");
  });
});

describe("svg", () => {
  it("is a standalone document with theme support and one group per node", () => {
    const svg = renderSvg(graph);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain("@media (prefers-color-scheme: dark)");
    expect(svg.match(/class="lt-node /g)).toHaveLength(graph.nodes.length);
    expect(svg.match(/class="lt-edge /g)).toHaveLength(graph.edges.length);
    expect(svg).not.toMatch(/<script/);
    expect(renderSvg(graph, { theme: "dark" })).toContain('data-theme="dark"');
  });
});

describe("html", () => {
  it("produces a single self-contained file", async () => {
    const html = await renderHtml(graph, { version: "test" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // No network access: no external scripts, stylesheets or fonts.
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href="https?:/);
    expect(html).not.toMatch(/@import|url\(https?:/);
    expect(html).toContain('id="viewport"');
    expect(html).toContain("prefers-color-scheme: dark");

    const data = /<script id="logictrail-data" type="application\/json">(.*?)<\/script>/s.exec(
      html,
    )?.[1];
    expect(data).toBeDefined();
    const parsed = JSON.parse(data ?? "{}") as {
      graph: LogicTrailGraph;
      layout: { nodes: unknown[] };
    };
    expect(parsed.graph.nodes).toHaveLength(graph.nodes.length);
    expect(parsed.layout.nodes).toHaveLength(graph.nodes.length);
  });

  it("cannot be broken out of by repository content", async () => {
    const hostile: LogicTrailGraph = {
      ...graph,
      title: '</title><script>alert("x")</script>',
      nodes: graph.nodes.map((node, index) =>
        index === 0
          ? { ...node, label: "</script><img src=x onerror=alert(1)>", description: "<b>bold</b>" }
          : node,
      ),
    };
    const html = await renderHtml(hostile, { version: "test" });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(safeJson({ text: "</script>\u2028" })).toBe('{"text":"\\u003c/script>\\u2028"}');
  });
});

describe("json", () => {
  it("round-trips the graph and can omit snippets", () => {
    expect(JSON.parse(renderJson(graph))).toEqual({ $schema: GRAPH_SCHEMA_URL, ...graph });
    const lean = JSON.parse(renderJson(graph, { snippets: false })) as LogicTrailGraph;
    expect(lean.nodes.some((node) => node.snippet)).toBe(false);
    expect(lean.schemaVersion).toBe(1);
  });

  it("matches the published JSON Schema", () => {
    const schema = JSON.parse(
      fs.readFileSync(path.join(ROOT, "schema/graph-v1.schema.json"), "utf8"),
    ) as { $id: string };
    expect(schema.$id).toBe(GRAPH_SCHEMA_URL);
    const validate = new Ajv2020({ allErrors: true, validateFormats: false }).compile(schema);
    const examples = fs
      .readdirSync(path.join(ROOT, "docs/examples"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => fs.readFileSync(path.join(ROOT, "docs/examples", name), "utf8"));
    for (const json of [renderJson(graph), renderJson(graph, { snippets: false }), ...examples]) {
      expect(validate(JSON.parse(json)), JSON.stringify(validate.errors)).toBe(true);
    }
  });
});
