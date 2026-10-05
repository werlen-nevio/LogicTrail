import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/config.js";
import type { LogicTrailGraph } from "../src/graph/model.js";
import { StaticProvider } from "../src/llm/static.js";
import { analyze, NoFlowFoundError } from "../src/pipeline.js";
import { ACME_SHOP, NEXT_APP, SERVER_FRAMEWORKS } from "./helpers.js";

const config = resolveConfig({ cache: false });

async function flow(question: string, root = ACME_SHOP): Promise<LogicTrailGraph> {
  const result = await analyze({ root, question, config, provider: new StaticProvider() });
  return result.graph;
}

function labels(graph: LogicTrailGraph): string[] {
  return graph.nodes.map((node) => node.label);
}

function edge(graph: LogicTrailGraph, from: string, to: string) {
  const ids = new Map(graph.nodes.map((node) => [node.label, node.id]));
  return graph.edges.find(
    (candidate) => candidate.from === ids.get(from) && candidate.to === ids.get(to),
  );
}

describe('vertical slice: "how does login work?"', () => {
  it("follows the flow from the login page through the API to the database", async () => {
    const graph = await flow("how does login work?");
    expect(graph.entryPoints).toHaveLength(1);
    expect(graph.nodes.find((node) => node.id === graph.entryPoints[0])?.label).toBe("LoginPage");
    expect(labels(graph)).toEqual(
      expect.arrayContaining([
        "LoginPage",
        "LoginForm",
        "handleSubmit()",
        "login()",
        "POST /api/auth/login",
        "loginRateLimit()",
        "validateBody()",
        "authController.login()",
        "findUserByEmail()",
        "user.findUnique",
        "verifyPassword()",
        "bcrypt.compare",
        "createSession()",
        "session.create",
        "setSessionCookie()",
        "user.loggedIn",
        "navigate /dashboard",
      ]),
    );
    expect(edge(graph, "login()", "POST /api/auth/login")).toMatchObject({ type: "requests" });
    expect(edge(graph, "POST /api/auth/login", "loginRateLimit()")).toMatchObject({
      label: "middleware",
    });
  });

  it("leaves out unrelated features", async () => {
    const graph = await flow("how does login work?");
    const all = labels(graph).join(" ");
    for (const unrelated of ["product", "Checkout", "Stripe", "AuthLayout", "logout", "Order"]) {
      expect(all).not.toContain(unrelated);
    }
  });

  it("models guards as condition nodes with yes/no branches and error exits", async () => {
    const graph = await flow("how does login work?");
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const condition = graph.nodes.find(
      (node) => node.type === "condition" && node.label === "!user",
    );
    expect(condition).toMatchObject({ file: "server/src/controllers/authController.ts", line: 18 });
    const arms = graph.edges
      .filter((candidate) => candidate.from === condition?.id)
      .map((candidate) => `${candidate.branch}:${nodes.get(candidate.to)?.label}`);
    expect(arms).toEqual(
      expect.arrayContaining([
        "yes:recordFailedLogin()",
        "yes:401 Unauthorized",
        "no:verifyPassword()",
      ]),
    );
    const errors = graph.nodes.filter((node) => node.type === "error").map((node) => node.label);
    expect(errors).toEqual(
      expect.arrayContaining(["401 Unauthorized", "429 Too Many Requests", "400 Bad Request"]),
    );
  });

  it("backs every node and static edge with source evidence", async () => {
    const graph = await flow("how does login work?");
    for (const node of graph.nodes) {
      expect(node.file, node.label).toBeTruthy();
      expect(node.line, node.label).toBeGreaterThan(0);
    }
    for (const item of graph.edges.filter((candidate) => candidate.source === "static")) {
      expect(item.evidence?.length, item.id).toBeGreaterThan(0);
      expect(item.evidence?.[0]?.file).toMatch(/\.(ts|tsx)$/);
    }
    const call = edge(graph, "authController.login()", "findUserByEmail()");
    expect(call?.evidence?.[0]).toMatchObject({
      file: "server/src/controllers/authController.ts",
      line: 17,
      kind: "call",
      text: "const user = await findUserByEmail(email);",
    });
  });

  it("embeds snippets and descriptions from doc comments", async () => {
    const graph = await flow("how does login work?");
    const controller = graph.nodes.find((node) => node.label === "authController.login()");
    expect(controller?.description).toBe(
      "Authenticates email + password and starts a cookie-based session.",
    );
    expect(controller?.descriptionSource).toBe("doc");
    expect(controller?.snippet?.startLine).toBe(14);
    expect(controller?.snippet?.lines[0]).toContain("async login(");
  });

  it("explains the flow without an LLM", async () => {
    const graph = await flow("how does login work?");
    expect(graph.analysis.provider).toBe("static");
    expect(graph.explanation).toContain("The flow starts at `LoginPage`");
    expect(graph.explanation).toContain(
      "`POST /api/auth/login` runs middleware `loginRateLimit()` and `validateBody()`",
    );
    expect(graph.explanation).toMatch(
      /If `!valid`: yes → .*`401 Unauthorized`; no → `createSession\(\)`/,
    );
  });

  it("is deterministic", async () => {
    const strip = (graph: LogicTrailGraph) => ({
      ...graph,
      analysis: { ...graph.analysis, generatedAt: "" },
    });
    expect(strip(await flow("how does login work?"))).toEqual(
      strip(await flow("how does login work?")),
    );
  });
});

describe("other questions", () => {
  it("follows checkout across the client, the API, Stripe and the inferred webhook", async () => {
    const graph = await flow("how does checkout work?");
    expect(labels(graph)).toEqual(
      expect.arrayContaining([
        "CheckoutPage",
        "handleCheckout()",
        "POST /api/orders",
        "OrdersController.create()",
        "validateCart()",
        "OrderService.createOrder()",
        "reserveInventory()",
        "Stripe: paymentIntents.create",
        "POST /api/webhooks/stripe",
        "markOrderPaid()",
      ]),
    );
    const webhook = edge(graph, "Stripe: paymentIntents.create", "POST /api/webhooks/stripe");
    expect(webhook).toMatchObject({ source: "inferred", confidence: 0.6, type: "triggers" });
    expect(webhook?.reason).toContain("webhook");
  });

  it("answers what happens when a payment fails", async () => {
    const graph = await flow("what happens when a payment fails?");
    expect(labels(graph)).toEqual(
      expect.arrayContaining([
        "markOrderFailed()",
        "releaseInventory()",
        "order.paymentFailed",
        "sendPaymentFailedEmail()",
      ]),
    );
    expect(labels(graph).join(" ")).not.toContain("LoginForm");
  });

  it("works on a Next.js app router project", async () => {
    const graph = await flow("how are orders placed?", NEXT_APP);
    expect(labels(graph)).toEqual(
      expect.arrayContaining([
        "placeOrder()",
        "POST /api/orders",
        "insertOrder()",
        "orders.insert",
      ]),
    );
    const errors = graph.nodes.filter((node) => node.type === "error").map((node) => node.label);
    expect(errors).toContain("400 Bad Request");
  });
});

describe("targets", () => {
  it("starts from a function", async () => {
    const result = await analyze({
      root: ACME_SHOP,
      target: { function: "createSession" },
      config,
      provider: new StaticProvider(),
    });
    expect(result.graph.query).toBe("What happens when createSession() runs?");
    expect(labels(result.graph)).toEqual(
      expect.arrayContaining(["createSession()", "session.create", "randomBytes"]),
    );
  });

  it("starts from a route and includes its callers", async () => {
    const result = await analyze({
      root: ACME_SHOP,
      target: { route: "POST /api/orders" },
      config,
      provider: new StaticProvider(),
    });
    expect(labels(result.graph)).toEqual(
      expect.arrayContaining(["POST /api/orders", "OrdersController.create()", "createOrder()"]),
    );
  });

  it("starts from a NestJS route with the global prefix", async () => {
    const result = await analyze({
      root: SERVER_FRAMEWORKS,
      target: { route: "GET /api/accounts/:id" },
      config,
      provider: new StaticProvider(),
    });
    expect(labels(result.graph)).toEqual(
      expect.arrayContaining([
        "GET /api/accounts/:id",
        "AccountsController.findOne()",
        "AccountsService.findOne()",
        "fetchAccount()",
      ]),
    );
  });

  it("starts from a file", async () => {
    const result = await analyze({
      root: ACME_SHOP,
      target: { file: "server/src/auth/session.ts" },
      config,
      provider: new StaticProvider(),
    });
    expect(labels(result.graph)).toEqual(
      expect.arrayContaining(["createSession()", "destroySession()", "setSessionCookie()"]),
    );
  });

  it("reports unknown targets with suggestions", async () => {
    await expect(
      analyze({
        root: ACME_SHOP,
        target: { function: "createSesion" },
        config,
        provider: new StaticProvider(),
      }),
    ).rejects.toBeInstanceOf(NoFlowFoundError);
    await expect(
      analyze({
        root: ACME_SHOP,
        question: "how does quantum teleportation work?",
        config,
        provider: new StaticProvider(),
      }),
    ).rejects.toThrow(/Could not find code related/);
  });
});
