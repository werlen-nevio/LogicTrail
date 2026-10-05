import { describe, expect, it } from "vitest";
import type { Step } from "../src/indexer/facts.js";
import { classifyFileRoute } from "../src/lang/javascript/file-routes.js";
import { callPaths, facts, symbol } from "./helpers.js";

describe("imports and exports", () => {
  it("records ES module imports, re-exports and default exports", () => {
    const result = facts(`
      import db, { user as users, type Session } from "./db";
      import * as auth from "../auth";
      export { createSession as startSession } from "./session";
      export * from "./helpers";
      export default function handler() {}
      export const VERSION = "1";
    `);
    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ local: "db", imported: "default", source: "./db" }),
        expect.objectContaining({ local: "users", imported: "user" }),
        expect.objectContaining({ local: "Session", imported: "Session", typeOnly: true }),
        expect.objectContaining({ local: "auth", imported: "*", source: "../auth" }),
      ]),
    );
    expect(result.exports).toEqual(
      expect.arrayContaining([
        {
          kind: "reexport",
          exported: "startSession",
          imported: "createSession",
          source: "./session",
          line: 4,
        },
        { kind: "reexport-all", source: "./helpers", line: 5 },
        { kind: "local", exported: "default", local: "handler", line: 6 },
        { kind: "local", exported: "VERSION", local: "VERSION", line: 7 },
      ]),
    );
  });

  it("understands CommonJS require and module.exports", () => {
    const result = facts(
      `
      const bcrypt = require("bcrypt");
      const { findUser } = require("./users");
      async function login(req, res) { return findUser(req.body.email); }
      module.exports = { login, logout: (req, res) => res.end() };
    `,
      "src/controller.js",
    );
    expect(result.imports.map((fact) => `${fact.local}<-${fact.source}:${fact.imported}`)).toEqual([
      "bcrypt<-bcrypt:default",
      "findUser<-./users:findUser",
    ]);
    expect(result.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exported: "default", local: "default" }),
        expect.objectContaining({ exported: "login", local: "default.login" }),
        expect.objectContaining({ exported: "logout", local: "default.logout" }),
      ]),
    );
    expect(symbol(result, "controller.logout").kind).toBe("method");
  });
});

describe("symbols", () => {
  it("finds functions, arrow functions, classes, methods and object members", () => {
    const result = facts(`
      /** Creates an order. */
      export async function createOrder() {}
      export const cancelOrder = async (id: string) => {};
      export class OrderService {
        constructor(private readonly repo: OrderRepository) {}
        async place() { return this.repo.save(); }
        refund = async () => {};
      }
      export const ordersController = {
        async create(req, res) {},
        list: (req, res) => {},
      };
    `);
    const createOrder = symbol(result, "createOrder");
    expect(createOrder).toMatchObject({
      kind: "function",
      async: true,
      line: 3,
      doc: "Creates an order.",
    });
    expect(symbol(result, "cancelOrder").params).toEqual(["id"]);
    expect(symbol(result, "OrderService").classInfo?.properties.repo).toEqual({
      typeName: "OrderRepository",
    });
    expect(symbol(result, "OrderService.place").kind).toBe("method");
    expect(symbol(result, "OrderService.refund").kind).toBe("method");
    expect(symbol(result, "ordersController.create").owner).toBe("ordersController");
    expect(symbol(result, "ordersController.list").kind).toBe("method");
    const binding = result.bindings.find((item) => item.name === "ordersController");
    expect(binding?.members?.create).toEqual({ kind: "symbol", symbol: "ordersController.create" });
  });

  it("detects React components and nested handlers", () => {
    const result = facts(
      `
      import { useCallback } from "react";
      export function LoginForm() {
        async function handleSubmit() { await login(); }
        const reset = useCallback(() => clearForm(), []);
        return <form onSubmit={handleSubmit}><button onClick={() => track("click")}>Sign in</button></form>;
      }
    `,
      "src/LoginForm.tsx",
    );
    expect(symbol(result, "LoginForm").kind).toBe("component");
    expect(symbol(result, "LoginForm.handleSubmit")).toMatchObject({
      scope: "nested",
      parent: "LoginForm",
    });
    expect(symbol(result, "LoginForm.reset").scope).toBe("nested");
    const steps = symbol(result, "LoginForm").steps;
    const refs = steps.filter(
      (step): step is Extract<Step, { kind: "ref" }> => step.kind === "ref",
    );
    expect(
      refs.map((step) => `${step.ref.context}:${step.ref.path.join(".")}:${step.ref.name ?? ""}`),
    ).toEqual(["jsx-attribute:handleSubmit:onSubmit"]);
    const track = steps.find((step) => step.kind === "call" && step.call.path[0] === "track");
    expect(track).toMatchObject({ call: { via: "onClick" } });
    expect(symbol(result, "LoginForm").literals).toContain("Sign in");
  });
});

describe("steps", () => {
  it("captures calls in order, fluent chains, loops and branches", () => {
    const result = facts(`
      export async function checkout(req, res) {
        const cart = await getCart(req.user.id);
        if (!cart.items.length) {
          return res.status(400).json({ error: "Empty cart" });
        }
        for (const item of cart.items) await reserve(item);
        const rows = await db.select().from(orders).where(eq(orders.id, 1));
        try {
          await charge(cart);
        } catch (error) {
          await release(cart);
          throw new PaymentError("Payment failed");
        }
        return res.status(201).json(rows);
      }
    `);
    const steps = symbol(result, "checkout").steps;
    expect(callPaths(steps)).toEqual([
      "getCart",
      "reserve",
      "eq",
      "db.select",
      "charge",
      "release",
    ]);

    const branch = steps.find((step) => step.kind === "branch");
    expect(branch).toMatchObject({ kind: "branch", test: "!cart.items.length", line: 4 });
    if (branch?.kind !== "branch") throw new Error("expected a branch");
    expect(branch.arms[0]).toMatchObject({ label: "then", terminates: true });
    expect(branch.arms[0]?.steps[0]).toMatchObject({
      kind: "exit",
      exit: { kind: "response", status: 400 },
    });

    const reserve = steps.find((step) => step.kind === "call" && step.call.path[0] === "reserve");
    expect(reserve).toMatchObject({ call: { inLoop: true, awaited: true } });

    const select = steps.find(
      (step) => step.kind === "call" && step.call.path.join(".") === "db.select",
    );
    expect(select).toMatchObject({ call: { chain: [{ name: "from" }, { name: "where" }] } });

    const handler = steps.find((step) => step.kind === "catch");
    expect(handler).toMatchObject({ kind: "catch", param: "error" });
    if (handler?.kind !== "catch") throw new Error("expected a catch");
    expect(handler.steps.at(-1)).toMatchObject({
      kind: "exit",
      exit: { kind: "throw", errorName: "PaymentError", message: "Payment failed" },
    });
    expect(steps.at(-1)).toMatchObject({ kind: "exit", exit: { kind: "response", status: 201 } });
  });

  it("does not mistake a fetch response variable for an HTTP response exit", () => {
    const result = facts(`
      export async function load() {
        const response = await fetch("/api/me");
        return response.json();
      }
    `);
    const steps = symbol(result, "load").steps;
    expect(steps.some((step) => step.kind === "exit")).toBe(false);
    expect(callPaths(steps)).toEqual(["fetch", "response.json"]);
  });

  it("flattens returned middleware closures and records env vars", () => {
    const result = facts(`
      export function validate(schema) {
        return (req, res, next) => {
          if (!schema.safeParse(req.body).success) return res.status(422).json({});
          if (!process.env.API_SECRET) next(new Error("misconfigured"));
          next();
        };
      }
    `);
    const validate = symbol(result, "validate");
    expect(validate.envVars).toEqual(["API_SECRET"]);
    const exits: string[] = [];
    const collect = (steps: readonly Step[]): void => {
      for (const step of steps) {
        if (step.kind === "exit")
          exits.push(`${step.exit.kind}:${step.exit.status ?? step.exit.errorName ?? ""}`);
        if (step.kind === "branch") for (const arm of step.arms) collect(arm.steps);
      }
    };
    collect(validate.steps);
    expect(exits).toEqual(["response:422", "throw:next(error)"]);
  });
});

describe("framework registrations", () => {
  it("extracts Express routes, mounts and inline handlers", () => {
    const result = facts(`
      import express, { Router } from "express";
      const app = express();
      const router = Router();
      router.post("/login", rateLimit, validate(schema), auth.login);
      router.route("/orders").get(listOrders).post(createOrder);
      router.get("/health", (req, res) => res.json({ ok: true }));
      app.use("/api", requireAuth, router);
    `);
    expect(
      result.routes.map(
        (route) => `${route.method} ${route.path} [${route.handlers.map((h) => h.kind).join(",")}]`,
      ),
    ).toEqual([
      "POST /login [path,call,path]",
      "GET /orders [path]",
      "POST /orders [path]",
      "GET /health [symbol]",
    ]);
    expect(result.mounts).toEqual([
      expect.objectContaining({
        router: ["app"],
        prefix: "/api",
        targets: [
          { kind: "path", path: ["requireAuth"] },
          { kind: "path", path: ["router"] },
        ],
      }),
    ]);
    expect(symbol(result, "GET /health").kind).toBe("handler");
  });

  it("extracts Fastify routes, route options and plugin prefixes", () => {
    const result = facts(`
      import Fastify from "fastify";
      const app = Fastify();
      app.get("/users/:id", { preHandler: [auth] }, getUser);
      app.route({ method: ["PUT", "PATCH"], url: "/users/:id", handler: updateUser });
      app.register(users, { prefix: "/api" });
      app.register(cors);
    `);
    expect(
      result.routes.map(
        (route) =>
          `${route.framework} ${route.method} ${route.path} [${route.handlers.map((h) => (h.kind === "path" ? h.path.join(".") : h.kind)).join(",")}]`,
      ),
    ).toEqual([
      "fastify GET /users/:id [auth,getUser]",
      "fastify PUT /users/:id [updateUser]",
      "fastify PATCH /users/:id [updateUser]",
    ]);
    expect(result.mounts.map((mount) => `${mount.kind} ${mount.prefix || "/"}`)).toEqual([
      "register /api",
      "register /",
    ]);
  });

  it("keys routes on a Fastify plugin's instance parameter by the plugin", () => {
    const result = facts(`
      import type { FastifyInstance } from "fastify";
      export default async function users(instance: FastifyInstance) {
        instance.get("/:id", getUser);
      }
    `);
    expect(result.routes).toEqual([
      expect.objectContaining({ framework: "fastify", router: ["instance"], routerOwner: "users" }),
    ]);
  });

  it("extracts Hono base paths and sub-app mounts", () => {
    const result = facts(`
      import { Hono } from "hono";
      const app = new Hono().basePath("/v1");
      const admin = app.basePath("/admin");
      admin.get("/stats", stats);
      app.route("/books", books);
    `);
    expect(result.routes.map((route) => `${route.framework} ${route.path}`)).toEqual([
      "hono /stats",
    ]);
    expect(result.mounts).toEqual([
      expect.objectContaining({ router: ["app"], prefix: "/v1", kind: "base-path" }),
      expect.objectContaining({
        router: ["app"],
        prefix: "/admin",
        targets: [{ kind: "path", path: ["admin"] }],
      }),
      expect.objectContaining({
        router: ["app"],
        prefix: "/books",
        targets: [{ kind: "path", path: ["books"] }],
      }),
    ]);
  });

  it("extracts Koa router prefixes and nested routers", () => {
    const result = facts(`
      import Router from "@koa/router";
      const router = new Router({ prefix: "/api" });
      router.get("/orders", ...guards, listOrders);
      router.use("/admin", admin.routes(), admin.allowedMethods());
    `);
    expect(result.routes).toEqual([
      expect.objectContaining({
        framework: "koa",
        path: "/orders",
        handlers: [
          { kind: "path", path: ["guards"] },
          { kind: "path", path: ["listOrders"] },
        ],
      }),
    ]);
    expect(result.mounts).toEqual([
      expect.objectContaining({ router: ["router"], prefix: "/api", kind: "base-path" }),
      expect.objectContaining({
        router: ["router"],
        prefix: "/admin",
        targets: [
          { kind: "path", path: ["admin"] },
          { kind: "call", path: ["admin", "allowedMethods"], text: "admin.allowedMethods()" },
        ],
      }),
    ]);
  });

  it("extracts NestJS controller routes", () => {
    const result = facts(`
      import { Controller, Get, Post as Create } from "@nestjs/common";
      @Controller("users")
      export class UsersController {
        @Get(":id") findOne() {}
        @Create() create() {}
        @Get(["", "all"]) list() {}
        helper() {}
      }
    `);
    expect(
      result.routes.map((route) => `${route.framework} ${route.method} ${route.path}`),
    ).toEqual([
      "nestjs GET /users/:id",
      "nestjs POST /users",
      "nestjs GET /users",
      "nestjs GET /users/all",
    ]);
    expect(result.routes[0]?.handlers).toEqual([
      { kind: "symbol", symbol: "UsersController.findOne" },
    ]);
  });

  it("does not treat HTTP client calls as routes", () => {
    const result = facts(`
      import axios from "axios";
      const api = axios.create({ baseURL: "/api" });
      export function save(order) { return api.post("/orders", order); }
    `);
    expect(result.routes).toEqual([]);
  });

  it("extracts event listeners and BullMQ workers", () => {
    const result = facts(`
      import { Worker } from "bullmq";
      bus.on("order.created", async (order) => { await notify(order); });
      bus.once("user.deleted", cleanup);
      new Worker("emails", async (job) => sendEmail(job.data));
    `);
    expect(
      result.listeners.map(
        (listener) => `${listener.channel}:${listener.event}:${listener.handler.kind}`,
      ),
    ).toEqual(["event:order.created:symbol", "event:user.deleted:path", "queue:emails:symbol"]);
  });

  it("extracts React Router pages", () => {
    const result = facts(
      `
      export const routes = [{ path: "/settings", element: <SettingsPage /> }];
      export function App() {
        return <Routes><Route path="/login" element={<LoginPage />} /></Routes>;
      }
    `,
      "src/App.tsx",
    );
    expect(
      result.pages.map(
        (page) =>
          `${page.path}:${page.component.kind === "path" ? page.component.path.join(".") : ""}`,
      ),
    ).toEqual(["/settings:SettingsPage", "/login:LoginPage"]);
  });

  it("derives Next.js routes and pages from file paths", () => {
    const route = facts(
      `export async function POST(req) {} export const GET = async () => {};`,
      "app/api/orders/[id]/route.ts",
    );
    expect(route.routes.map((item) => `${item.method} ${item.path}`)).toEqual([
      "POST /api/orders/:id",
      "GET /api/orders/:id",
    ]);
    const page = facts(
      `export default function Checkout() { return <div />; }`,
      "src/app/(shop)/checkout/page.tsx",
    );
    expect(page.pages).toEqual([
      expect.objectContaining({ path: "/checkout", framework: "next-app" }),
    ]);
    const api = facts(`export default function handler(req, res) {}`, "pages/api/users/[id].ts");
    expect(api.routes).toEqual([
      expect.objectContaining({ method: "ANY", path: "/api/users/:id", framework: "next-pages" }),
    ]);
  });

  it("classifies file routes", () => {
    expect(classifyFileRoute("app/route.ts")).toEqual({ kind: "next-app-route", urlPath: "/" });
    expect(classifyFileRoute("app/blog/[...slug]/page.tsx")).toEqual({
      kind: "next-app-page",
      urlPath: "/blog/:slug*",
    });
    expect(classifyFileRoute("pages/_app.tsx")).toBeUndefined();
    expect(classifyFileRoute("src/services/route.css")).toBeUndefined();
  });
});

describe("robustness", () => {
  it("keeps going on syntax errors and reports them", () => {
    const result = facts(`export function ok() { return 1; }\nexport function broken( {`);
    expect(result.parseErrors).toBeGreaterThan(0);
    expect(symbol(result, "ok").kind).toBe("function");
  });
});
