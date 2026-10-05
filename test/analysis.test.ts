import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/analysis/adapters/http.js";
import { parseSql } from "../src/analysis/adapters/data.js";
import { joinPaths, RouteMatcher, type RouteDefinition } from "../src/analysis/routes.js";
import { Workspace } from "../src/analysis/workspace.js";
import { JavaScriptModuleResolver } from "../src/lang/javascript/module-resolver.js";
import {
  ACME_SHOP,
  edgeLabels,
  facts,
  fixtureGraph,
  NEXT_APP,
  nodeByLabel,
  SERVER_FRAMEWORKS,
} from "./helpers.js";

describe("module resolution", () => {
  const files = new Set([
    "src/a.ts",
    "src/lib/db.ts",
    "src/lib/index.ts",
    "src/util.tsx",
    "client/src/api/auth.ts",
    "client/src/components/LoginForm.tsx",
  ]);
  const resolver = new JavaScriptModuleResolver({ root: ACME_SHOP, files });

  it("resolves relative specifiers with extension probing and index files", () => {
    expect(resolver.resolve("src/a.ts", "./lib/db")).toEqual({
      kind: "file",
      path: "src/lib/db.ts",
    });
    expect(resolver.resolve("src/a.ts", "./lib")).toEqual({
      kind: "file",
      path: "src/lib/index.ts",
    });
    expect(resolver.resolve("src/a.ts", "./util.js")).toEqual({
      kind: "file",
      path: "src/util.tsx",
    });
    expect(resolver.resolve("src/lib/db.ts", "../missing")).toEqual({ kind: "unresolved" });
  });

  it("uses tsconfig paths from the nearest config", () => {
    // examples/acme-shop/client/tsconfig.json maps @/* to src/*
    expect(resolver.resolve("client/src/components/LoginForm.tsx", "@/api/auth")).toEqual({
      kind: "file",
      path: "client/src/api/auth.ts",
    });
  });

  it("classifies bare specifiers as packages", () => {
    expect(resolver.resolve("src/a.ts", "@prisma/client")).toEqual({
      kind: "package",
      name: "@prisma/client",
      subpath: "",
    });
    expect(resolver.resolve("src/a.ts", "node:events")).toEqual({
      kind: "package",
      name: "events",
      subpath: "",
    });
    expect(resolver.resolve("src/a.ts", "drizzle-orm/pg-core")).toEqual({
      kind: "package",
      name: "drizzle-orm",
      subpath: "pg-core",
    });
  });
});

describe("workspace resolution", () => {
  const workspace = new Workspace(
    [
      facts(
        `export { createSession as startSession } from "./session"; export * from "./tokens";`,
        "src/auth/index.ts",
      ),
      facts(`export async function createSession() {}`, "src/auth/session.ts"),
      facts(`export function signToken() {}`, "src/auth/tokens.ts"),
      facts(
        `
        import { PrismaClient } from "@prisma/client";
        export const db = new PrismaClient();
        export class UserRepo { find() { return db.user.findMany(); } }
        export const repo = new UserRepo();
      `,
        "src/db.ts",
      ),
      facts(
        `
        import * as auth from "./auth";
        import { startSession, signToken } from "./auth";
        import { db, repo, UserRepo } from "./db";
        export class Controller {
          constructor(private readonly users: UserRepo) {}
          run() { return this.users.find(); }
        }
        export function main() { auth.startSession(); startSession(); signToken(); repo.find(); db.order.create(); }
      `,
        "src/main.ts",
      ),
    ],
    "/repo",
  );

  const resolve = (path: string[], scope?: string) => {
    const facts = workspace.files.get("src/main.ts");
    const symbol = scope ? facts?.symbols.find((s) => s.qualifiedName === scope) : undefined;
    return workspace.resolvePath("src/main.ts", symbol, path);
  };

  it("follows named and wildcard re-exports and namespace imports", () => {
    expect(resolve(["startSession"])).toMatchObject({
      kind: "symbol",
      file: "src/auth/session.ts",
      symbol: { name: "createSession" },
    });
    expect(resolve(["auth", "startSession"])).toMatchObject({
      kind: "symbol",
      symbol: { name: "createSession" },
    });
    expect(resolve(["signToken"])).toMatchObject({ kind: "symbol", file: "src/auth/tokens.ts" });
  });

  it("resolves methods on class instances, including injected properties", () => {
    expect(resolve(["repo", "find"])).toMatchObject({
      kind: "symbol",
      symbol: { qualifiedName: "UserRepo.find" },
    });
    expect(resolve(["this", "users", "find"], "Controller.run")).toMatchObject({
      kind: "symbol",
      symbol: { qualifiedName: "UserRepo.find" },
    });
  });

  it("tracks values created by packages", () => {
    expect(resolve(["db", "order", "create"])).toEqual({
      kind: "package",
      value: {
        pkg: "@prisma/client",
        imported: "PrismaClient",
        ops: [{ op: "new", member: [], args: [] }],
        member: ["order", "create"],
      },
    });
  });
});

describe("code graph on the Express + React sample", () => {
  it("composes Express routes across files and inherits mount middleware", async () => {
    const { graph } = await fixtureGraph(ACME_SHOP);
    const routes = graph.routes.map((route) => route.id);
    expect(routes).toEqual(
      expect.arrayContaining([
        "route:POST /api/auth/login",
        "route:POST /api/orders",
        "route:GET /api/orders/:id",
        "route:GET /api/products",
        "route:POST /api/webhooks/stripe",
      ]),
    );
    expect(edgeLabels(graph, "POST /api/auth/login")).toEqual([
      "calls:loginRateLimit()",
      "calls:validateBody()",
      "calls:authController.login()",
    ]);
    // requireAuth is attached where ordersRouter is mounted: app.use("/api/orders", requireAuth, ordersRouter)
    expect(edgeLabels(graph, "POST /api/orders")).toContain("calls:requireAuth()");
    expect(edgeLabels(graph, "POST /api/orders")).toContain("calls:OrdersController.create()");
  });

  it("links client requests to server routes", async () => {
    const { graph } = await fixtureGraph(ACME_SHOP);
    expect(edgeLabels(graph, "login()")).toContain("requests:POST /api/auth/login");
    // axios instance with baseURL "/api"
    expect(edgeLabels(graph, "createOrder()")).toContain("requests:POST /api/orders");
    const login = graph.out(nodeByLabel(graph, "login()")).find((edge) => edge.kind === "requests");
    expect(login).toMatchObject({ file: "client/src/api/auth.ts", line: 8, confidence: 0.95 });
  });

  it("classifies database, external, library, event and queue calls", async () => {
    const { graph } = await fixtureGraph(ACME_SHOP);
    expect(edgeLabels(graph, "findUserByEmail()")).toEqual(["reads:user.findUnique"]);
    expect(edgeLabels(graph, "createSession()")).toEqual([
      "calls:randomBytes",
      "writes:session.create",
    ]);
    expect(edgeLabels(graph, "verifyPassword()")).toEqual(["calls:bcrypt.compare"]);
    expect(edgeLabels(graph, "createPaymentIntent()")).toEqual([
      "calls:Stripe: paymentIntents.create",
    ]);
    expect(edgeLabels(graph, "loginRateLimit()")).toEqual([
      "writes:redis.incr",
      "writes:redis.expire",
    ]);
    expect(edgeLabels(graph, "markOrderPaid()")).toEqual([
      "writes:order.update",
      "emits:emails queue",
    ]);
    expect(edgeLabels(graph, "emails queue")).toEqual(["triggers:worker emails handler"]);
    expect(edgeLabels(graph, "user.loggedIn")).toEqual(["triggers:on user.loggedIn handler"]);
    expect(edgeLabels(graph, "OrdersController.create()")).toEqual(
      expect.arrayContaining(["calls:OrderService.createOrder()", "calls:createPaymentIntent()"]),
    );
  });

  it("infers webhook continuations and marks them as inferred", async () => {
    const { graph } = await fixtureGraph(ACME_SHOP);
    const webhook = graph.inferredEdges.find(
      (edge) => graph.nodes.get(edge.from)?.label === "Stripe: paymentIntents.create",
    );
    expect(webhook).toMatchObject({
      to: "route:POST /api/webhooks/stripe",
      kind: "triggers",
      confidence: 0.6,
    });
    expect(webhook?.inferred?.reason).toMatch(/webhook/);
  });

  it("records pages and renders edges", async () => {
    const { graph } = await fixtureGraph(ACME_SHOP);
    const loginPage = graph.nodes.get(nodeByLabel(graph, "LoginPage"));
    expect(loginPage?.metadata.pages).toEqual(["/login"]);
    expect(edgeLabels(graph, "LoginPage")).toEqual([
      "renders:AuthLayout",
      "renders:LoginForm",
      "navigates:navigate /dashboard",
    ]);
  });
});

describe("code graph on the Next.js + Drizzle sample", () => {
  it("builds file-based routes, drizzle operations and server actions", async () => {
    const { graph } = await fixtureGraph(NEXT_APP);
    expect(graph.routes.map((route) => route.id).sort()).toEqual([
      "route:ANY /api/legacy",
      "route:GET /api/orders/:id",
      "route:POST /api/orders",
    ]);
    expect(edgeLabels(graph, "POST /api/orders")).toEqual(["calls:POST()"]);
    expect(edgeLabels(graph, "insertOrder()")).toEqual(["writes:orders.insert"]);
    expect(edgeLabels(graph, "getOrder()")).toEqual(["reads:orders.select"]);
    expect(edgeLabels(graph, "placeOrder()")).toEqual([
      "requests:POST /api/orders",
      "navigates:navigate /orders/:param",
    ]);
    expect(edgeLabels(graph, "CheckoutPage")).toEqual(["calls:saveDraft()", "calls:placeOrder()"]);
  });
});

describe("code graph on Fastify, Hono, Koa and NestJS servers", () => {
  it("composes plugin, sub-app, router and controller prefixes", async () => {
    const { graph } = await fixtureGraph(SERVER_FRAMEWORKS);
    expect(graph.routes.map((route) => `${route.framework} ${route.method} ${route.path}`)).toEqual(
      expect.arrayContaining([
        "fastify GET /health",
        "fastify GET /api/users/:id",
        "fastify PUT /api/users/:id",
        "fastify PATCH /api/users/:id",
        "fastify POST /api/auth/login",
        "hono GET /v1/status",
        "hono GET /v1/books",
        "hono POST /v1/books/:id/reviews",
        "koa GET /shop/orders/:id",
        "koa POST /shop/orders",
        "nestjs GET /api/accounts/:id",
        "nestjs POST /api/accounts",
      ]),
    );
    expect(graph.routes).toHaveLength(12);
    expect([...graph.frameworks]).toEqual(
      expect.arrayContaining(["fastify", "hono", "koa", "nestjs"]),
    );
  });

  it("resolves handlers, hooks and middleware", async () => {
    const { graph } = await fixtureGraph(SERVER_FRAMEWORKS);
    expect(edgeLabels(graph, "GET /api/users/:id")).toEqual([
      "calls:requireAuth()",
      "calls:getUser()",
    ]);
    expect(edgeLabels(graph, "POST /api/auth/login")).toEqual(["calls:login()"]);
    // app.use("*", timing) runs before every route of the app, including mounted sub-apps.
    expect(edgeLabels(graph, "POST /v1/books/:id/reviews")).toEqual([
      "calls:timing()",
      "calls:validateReview()",
      "calls:POST /v1/books/:id/reviews handler",
    ]);
    expect(edgeLabels(graph, "GET /shop/orders/:id")).toEqual([
      "calls:requireUser()",
      "calls:GET /shop/orders/:id handler",
    ]);
    expect(edgeLabels(graph, "GET /api/accounts/:id")).toEqual([
      "calls:AccountsController.findOne()",
    ]);
    // The service is injected through the controller's constructor.
    expect(edgeLabels(graph, "AccountsController.findOne()")).toEqual([
      "calls:AccountsService.findOne()",
    ]);
  });

  it("links client requests to the composed routes", async () => {
    const { graph } = await fixtureGraph(SERVER_FRAMEWORKS);
    expect(edgeLabels(graph, "fetchUser()")).toEqual(["requests:GET /api/users/:id"]);
    expect(edgeLabels(graph, "postReview()")).toEqual(["requests:POST /v1/books/:id/reviews"]);
    expect(edgeLabels(graph, "fetchOrder()")).toEqual(["requests:GET /shop/orders/:id"]);
    expect(edgeLabels(graph, "fetchAccount()")).toEqual(["requests:GET /api/accounts/:id"]);
  });
});

describe("helpers", () => {
  it("normalizes URLs", () => {
    expect(normalizeUrl("/api/orders/${id}?expand=1")).toEqual({
      raw: "/api/orders/${id}?expand=1",
      path: "/api/orders/:param",
      unknownPrefix: false,
    });
    expect(normalizeUrl("${API_URL}/orders")).toMatchObject({
      path: "/orders",
      unknownPrefix: true,
    });
    expect(normalizeUrl("https://api.github.com/user")).toMatchObject({
      host: "api.github.com",
      path: "/user",
    });
    expect(normalizeUrl("orders", "/api")).toMatchObject({
      path: "/api/orders",
      unknownPrefix: false,
    });
  });

  it("matches requests to routes exactly and by suffix", () => {
    const route = (method: string, path: string): RouteDefinition => ({
      id: `route:${method} ${path}`,
      method,
      path,
      framework: "express",
      file: "x.ts",
      line: 1,
      text: "",
      handlers: [],
    });
    const matcher = new RouteMatcher([
      route("GET", "/api/orders/:id"),
      route("POST", "/api/orders"),
      route("ANY", "/api/legacy"),
    ]);
    expect(matcher.match("GET", "/api/orders/:param", false)).toMatchObject({
      route: { path: "/api/orders/:id" },
      confidence: 0.95,
    });
    expect(matcher.match("POST", "/orders", true)).toMatchObject({
      route: { path: "/api/orders" },
      confidence: 0.65,
    });
    expect(matcher.match("DELETE", "/api/orders", false)).toBeUndefined();
    expect(matcher.match("PUT", "/api/legacy", false)?.route.path).toBe("/api/legacy");
  });

  it("joins route paths", () => {
    expect(joinPaths("/api/", "/auth", "login")).toBe("/api/auth/login");
    expect(joinPaths("", "/")).toBe("/");
  });

  it("parses SQL statements", () => {
    expect(parseSql("SELECT * FROM users WHERE id = $1")).toEqual({
      verb: "select",
      table: "users",
    });
    expect(parseSql("insert into orders (id) values ($1)")).toEqual({
      verb: "insert",
      table: "orders",
    });
    expect(parseSql("UPDATE sessions SET x = 1")).toEqual({ verb: "update", table: "sessions" });
  });
});
