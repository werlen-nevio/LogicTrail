import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/analysis/adapters/http.js";
import { parseSql } from "../src/analysis/adapters/data.js";
import {
  composeRoutes,
  joinPaths,
  routeLabel,
  RouteMatcher,
  type RouteDefinition,
} from "../src/analysis/routes.js";
import { buildCodeGraph } from "../src/analysis/code-graph.js";
import { Workspace } from "../src/analysis/workspace.js";
import { NoFlowFoundError, seedsForTarget } from "../src/pipeline.js";
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

describe("monorepo workspace packages", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "logictrail-monorepo-"));
  const write = (file: string, content: unknown): void => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(content));
  };
  write("package.json", { name: "root", private: true, workspaces: ["apps/*", "packages/*"] });
  write("apps/api/package.json", { name: "@acme/api" });
  write("packages/features/package.json", { name: "@acme/features", main: "index.ts" });
  write("packages/enums/package.json", { name: "@acme/enums", main: "./dist/index.js" });
  write("packages/atoms/package.json", {
    name: "@acme/atoms",
    exports: { ".": { import: "./dist/atoms.js" }, "./button": "./button.tsx" },
  });
  write("packages/libraries/package.json", {
    name: "@acme/libraries",
    exports: {
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./bookings": "./bookings.ts",
      "./utils/*": { import: "./dist/utils/*.js" },
    },
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const files = [
    "apps/api/src/booking.service.ts",
    "packages/features/index.ts",
    "packages/features/bookings/RegularBookingService.ts",
    "packages/libraries/bookings.ts",
    "packages/libraries/src/index.ts",
    "packages/libraries/src/utils/dates.ts",
    "packages/enums/index.ts",
    "packages/atoms/index.ts",
    "packages/atoms/button.tsx",
  ];

  it("resolves workspace packages to their sources", () => {
    const resolver = new JavaScriptModuleResolver({ root, files: new Set(files) });
    const from = "apps/api/src/booking.service.ts";
    expect(resolver.resolve(from, "@acme/features")).toEqual({
      kind: "file",
      path: "packages/features/index.ts",
    });
    expect(resolver.resolve(from, "@acme/features/bookings/RegularBookingService")).toEqual({
      kind: "file",
      path: "packages/features/bookings/RegularBookingService.ts",
    });
    expect(resolver.resolve(from, "@acme/libraries/bookings")).toEqual({
      kind: "file",
      path: "packages/libraries/bookings.ts",
    });
    // Built entries in `exports` map back to src/.
    expect(resolver.resolve(from, "@acme/libraries")).toEqual({
      kind: "file",
      path: "packages/libraries/src/index.ts",
    });
    expect(resolver.resolve(from, "@acme/libraries/utils/dates")).toEqual({
      kind: "file",
      path: "packages/libraries/src/utils/dates.ts",
    });
    // Built entries whose sources sit at the package root, or only in its index.
    expect(resolver.resolve(from, "@acme/enums")).toEqual({
      kind: "file",
      path: "packages/enums/index.ts",
    });
    expect(resolver.resolve(from, "@acme/atoms")).toEqual({
      kind: "file",
      path: "packages/atoms/index.ts",
    });
    expect(resolver.resolve(from, "@acme/atoms/button")).toEqual({
      kind: "file",
      path: "packages/atoms/button.tsx",
    });
    expect(resolver.resolve(from, "@acme/unknown")).toEqual({
      kind: "package",
      name: "@acme/unknown",
      subpath: "",
    });
  });

  it("links a method inherited from a base class in another workspace package", () => {
    const workspace = new Workspace(
      [
        facts(
          `
          export class RegularBookingService {
            async createBooking(input) { return input; }
          }
        `,
          "packages/features/bookings/RegularBookingService.ts",
        ),
        facts(
          `export { RegularBookingService } from "@acme/features/bookings/RegularBookingService";`,
          "packages/libraries/bookings.ts",
        ),
        facts(
          `
          import { RegularBookingService as BaseRegularBookingService } from "@acme/libraries/bookings";
          export class RegularBookingService extends BaseRegularBookingService {}
          export class BookingsService {
            constructor(private readonly regularBookingService: RegularBookingService) {}
            async create(body) { return this.regularBookingService.createBooking(body); }
          }
        `,
          "apps/api/src/booking.service.ts",
        ),
      ],
      root,
    );
    const graph = buildCodeGraph(workspace);
    expect(edgeLabels(graph, "BookingsService.create()")).toEqual([
      "calls:RegularBookingService.createBooking()",
    ]);
  });
});

describe("member calls on repository classes", () => {
  const workspace = new Workspace(
    [
      facts(
        `
        import { Mixin } from "./missing";
        class BaseRepository {
          save(entity) { return entity; }
        }
        class UserRepository extends BaseRepository {}
        class AuditedRepository extends Mixin {}
        export class UserService {
          private notify = withReporting(() => {});
          constructor(private users: UserRepository, private audit: AuditedRepository) {}
          register(user) {
            this.users.save(user);
            this.audit.record(user);
            this.users.missing(user);
            this.notify(user);
            const local = new UserRepository().findMany();
            local.map(String);
          }
        }
      `,
        "src/users.ts",
      ),
    ],
    "/repo",
  );
  const graph = buildCodeGraph(workspace);

  it("walks the extends chain and keeps unresolvable methods as unresolved steps", () => {
    expect(edgeLabels(graph, "UserService.register()")).toEqual([
      "calls:BaseRepository.save()",
      "calls:AuditedRepository.record()",
      "calls:UserRepository.missing()",
      "calls:UserService.notify()",
    ]);
    expect(graph.nodes.get(nodeByLabel(graph, "UserService.notify()"))?.metadata).toMatchObject({
      property: true,
    });
    const unresolved = graph.nodes.get(nodeByLabel(graph, "AuditedRepository.record()"));
    expect(unresolved).toMatchObject({
      kind: "unresolved",
      file: "src/users.ts",
      metadata: { unresolved: true, owner: "AuditedRepository", extends: "Mixin" },
    });
    const edge = graph.out(nodeByLabel(graph, "UserService.register()"))[1];
    expect(edge?.confidence).toBe(0.5);
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

describe("destructured hook results", () => {
  const workspace = new Workspace(
    [
      facts(
        `
        import { useMemo, useOptimistic } from "react";
        function cartReducer(state, action) { return state; }
        export function useCart() {
          const [cart, updateCart] = useOptimistic([], cartReducer);
          const addCartItem = (item) => { updateCart({ type: "ADD_ITEM", item }); };
          function clear() {}
          return useMemo(() => ({ cart, addCartItem, reset: clear }), [cart]);
        }
        export function useSession() {
          const signOut = () => {};
          return { signOut };
        }
      `,
        "src/cart.tsx",
      ),
      facts(
        `
        import { useCart, useSession } from "./cart";
        export function AddToCart() {
          const { addCartItem, reset: emptyCart } = useCart();
          const session = useSession();
          return <form action={() => { addCartItem({}); emptyCart(); session.signOut(); }} />;
        }
      `,
        "src/add-to-cart.tsx",
      ),
    ],
    "/repo",
  );
  const graph = buildCodeGraph(workspace);

  it("resolves members of the object a hook returns", () => {
    expect(edgeLabels(graph, "AddToCart")).toEqual(
      expect.arrayContaining(["calls:addCartItem()", "calls:clear()", "calls:signOut()"]),
    );
  });

  it("follows a useOptimistic or useReducer dispatcher to its reducer", () => {
    expect(edgeLabels(graph, "addCartItem()")).toEqual(["calls:cartReducer()"]);
  });
});

describe("NestJS modules, versions and enhancers", () => {
  const nestFiles = (main: string) => [
    facts(
      `
      import { Controller, Get, Post, UseGuards, UseInterceptors, UsePipes, Version, ValidationPipe } from "@nestjs/common";
      import { AuthGuard } from "./auth.guard";
      import { RolesGuard, LoggingInterceptor } from "./enhancers";
      @Controller({ path: "cats", version: ["1", "2"] })
      @UseGuards(AuthGuard)
      @UseInterceptors(LoggingInterceptor)
      export class CatsController {
        @Get() findAll() {}
        @Post() @UseGuards(RolesGuard) @UsePipes(new ValidationPipe()) create() {}
        @Get("health") @Version("3") health() {}
      }
    `,
      "src/cats/cats.controller.ts",
    ),
    facts(`export class AuthGuard { canActivate() { return true; } }`, "src/cats/auth.guard.ts"),
    facts(
      `
      export class RolesGuard { canActivate() { return true; } }
      export class LoggingInterceptor { intercept() {} }
    `,
      "src/cats/enhancers.ts",
    ),
    facts(
      `
      import { Module } from "@nestjs/common";
      import { CatsController } from "./cats.controller";
      @Module({ controllers: [CatsController] })
      export class CatsModule {}
    `,
      "src/cats/cats.module.ts",
    ),
    facts(
      `
      import { Controller, Get } from "@nestjs/common";
      @Controller("status")
      export class StatusController { @Get() status() {} }
    `,
      "src/status.controller.ts",
    ),
    facts(
      `
      import { Module } from "@nestjs/common";
      import { RouterModule } from "@nestjs/core";
      import { CatsModule } from "./cats/cats.module";
      @Module({ imports: [CatsModule, RouterModule.register([{ path: "pets", module: CatsModule }])] })
      export class AppModule {}
    `,
      "src/app.module.ts",
    ),
    facts(
      `
      import { Module } from "@nestjs/common";
      import { StatusController } from "./status.controller";
      @Module({ controllers: [StatusController] })
      export class AdminModule {}
    `,
      "src/admin.module.ts",
    ),
    facts(main, "src/main.ts"),
  ];
  const labels = (main: string) =>
    composeRoutes(new Workspace(nestFiles(main), "/repo"))
      .map(routeLabel)
      .sort();

  it("puts URI versions after the global prefix and RouterModule paths before the controller", () => {
    expect(
      labels(`
        import { NestFactory } from "@nestjs/core";
        import { VersioningType, RequestMethod } from "@nestjs/common";
        import { AppModule } from "./app.module";
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          app.setGlobalPrefix("api", { exclude: [{ path: "pets/cats/health", method: RequestMethod.GET }] });
          app.enableVersioning({ type: VersioningType.URI });
        }
      `),
    ).toEqual([
      "GET /api/v1/pets/cats",
      "GET /api/v2/pets/cats",
      "GET /status",
      "GET /v3/pets/cats/health",
      "POST /api/v1/pets/cats",
      "POST /api/v2/pets/cats",
    ]);
  });

  it("labels header versions and knows which routes serve the default version", () => {
    const routes = composeRoutes(
      new Workspace(
        nestFiles(`
          import { NestFactory } from "@nestjs/core";
          import { VersioningType } from "@nestjs/common";
          import { AppModule } from "./app.module";
          export async function bootstrap() {
            const app = await NestFactory.create(AppModule);
            app.enableVersioning({ type: VersioningType.HEADER, header: "x-version", defaultVersion: "3" });
          }
        `),
        "/repo",
      ),
    );
    expect(routes.map(routeLabel).sort()).toEqual([
      "GET /pets/cats (versions 1, 2)",
      "GET /pets/cats/health (version 3)",
      "GET /status",
      "POST /pets/cats (versions 1, 2)",
    ]);
    expect(
      routes.filter((route) => route.servesDefault !== false).map((route) => route.path),
    ).toEqual(expect.arrayContaining(["/pets/cats/health", "/status"]));
    expect(routes.find((route) => route.path === "/pets/cats")?.servesDefault).toBe(false);
  });

  it("picks a --route by version, or the default version without one", () => {
    const graph = buildCodeGraph(
      new Workspace(
        nestFiles(`
          import { NestFactory } from "@nestjs/core";
          import { VersioningType } from "@nestjs/common";
          import { AppModule } from "./app.module";
          export async function bootstrap() {
            const app = await NestFactory.create(AppModule);
            app.enableVersioning({ type: VersioningType.CUSTOM, extractor: () => "1", defaultVersion: "2" });
          }
        `),
        "/repo",
      ),
    );
    const seeds = (route: string) => seedsForTarget(graph, { route }, "/repo");
    expect(seeds("GET /pets/cats")).toEqual(["route:GET /pets/cats (versions 1, 2)"]);
    expect(seeds("GET /pets/cats (version 1)")).toEqual(["route:GET /pets/cats (versions 1, 2)"]);
    expect(() => seeds("GET /pets/cats (version 4)")).toThrow(NoFlowFoundError);
  });

  it("runs guards, then interceptors, then pipes before the handler", () => {
    const graph = buildCodeGraph(new Workspace(nestFiles(""), "/repo"));
    expect(
      graph
        .out("route:POST /pets/cats")
        .map((edge) => [edge.label, graph.nodes.get(edge.to)?.label]),
    ).toEqual([
      ["guard", "AuthGuard.canActivate()"],
      ["guard", "RolesGuard.canActivate()"],
      ["interceptor", "LoggingInterceptor.intercept()"],
      [undefined, "CatsController.create()"],
    ]);
  });
});

describe("--route on pages", () => {
  const graph = buildCodeGraph(
    new Workspace(
      [
        facts(`export default function SearchPage() { return <main />; }`, "app/search/page.tsx"),
        facts(
          `export default function ProductPage() { return <main />; }`,
          "app/product/[handle]/page.tsx",
        ),
        facts(
          `export async function POST(request) { return Response.json({}); }`,
          "app/api/revalidate/route.ts",
        ),
        facts(
          `export async function GET() { return Response.json([]); }`,
          "app/search/api/route.ts",
        ),
      ],
      "/repo",
    ),
  );
  const seeds = (route: string) =>
    seedsForTarget(graph, { route }, "/repo").map((id) => graph.nodes.get(id)?.label);

  it("starts at the page component for GET or a bare path", () => {
    expect(seeds("GET /search")).toEqual(["SearchPage"]);
    expect(seeds("/search")).toEqual(["SearchPage"]);
    expect(seeds("GET /product/:handle")).toEqual(["ProductPage"]);
    expect(seeds("/product/[handle]")).toEqual(["ProductPage"]);
    expect(seeds("GET /search/api")).toEqual(["GET /search/api"]);
  });

  it("only matches pages for GET and lists them when nothing matches", () => {
    expect(() => seeds("POST /search")).toThrow(NoFlowFoundError);
    const suggestions = (): string[] => {
      try {
        seeds("GET /serch");
      } catch (error) {
        if (error instanceof NoFlowFoundError) return error.suggestions;
      }
      return [];
    };
    expect(suggestions()[0]).toBe("Available: GET /search (page SearchPage)");
  });
});

describe("functions exported through a wrapper", () => {
  const graph = buildCodeGraph(
    new Workspace(
      [
        facts(
          `
          export function withReporting(fn, name) { return (...args) => fn(...args); }
          export function defaultResponder(fn, path) { return async (req, res) => fn(req, res); }
        `,
          "lib/wrappers.ts",
        ),
        facts(
          `
          import { withReporting } from "../lib/wrappers";
          const _ensureAvailableUsers = async (users) => users;
          export const ensureAvailableUsers = withReporting(_ensureAvailableUsers, "ensureAvailableUsers");
          export class BookingService {
            private getEventType = withReporting(this._getEventType.bind(this), "getEventType");
            private async _getEventType(id) { return id; }
            async createBooking(input) {
              await this.getEventType(input.id);
              return ensureAvailableUsers(input.users);
            }
          }
        `,
          "lib/booking.ts",
        ),
        facts(
          `
          import { defaultResponder } from "../../../lib/wrappers";
          import { BookingService } from "../../../lib/booking";
          async function handler(req) { return new BookingService().createBooking(req.body); }
          export default defaultResponder(handler, "/api/book/event");
        `,
          "pages/api/book/event.ts",
        ),
        facts(
          `
          import { defaultResponder } from "../../../lib/wrappers";
          async function handler(req) { return req; }
          export const POST = defaultResponder(handler);
        `,
          "app/api/cancel/route.ts",
        ),
        facts(
          `
          function keyOf(item) { return item.id; }
          function sortBy(list, key) { return list; }
          function render(rows) {}
          export function table(list) {
            const sorted = sortBy(list, keyOf);
            render(sorted);
          }
        `,
          "lib/table.ts",
        ),
      ],
      "/repo",
    ),
  );

  it("calls through a wrapper reach the wrapped function", () => {
    expect(
      graph
        .out(nodeByLabel(graph, "BookingService.createBooking()"))
        .map((edge) => `${graph.nodes.get(edge.to)?.label} ${edge.label ?? ""}`.trim()),
    ).toEqual([
      "BookingService._getEventType() via withReporting",
      "_ensureAvailableUsers() via withReporting",
    ]);
  });

  it("route handlers exported through a wrapper are linked", () => {
    expect(edgeLabels(graph, "ANY /api/book/event")).toEqual(["calls:handler()"]);
    expect(edgeLabels(graph, "POST /api/cancel")).toEqual(["calls:handler()"]);
  });

  it("does not unwrap calls inside functions", () => {
    // `keyOf` is passed to sortBy as a callback; `sorted` is sortBy's result, not keyOf.
    const steps = graph.steps.get(nodeByLabel(graph, "table()")) ?? [];
    expect(
      steps.map((step) =>
        step.kind === "edge"
          ? `${graph.nodes.get(step.edge.to)?.label} ${step.edge.label ?? ""}`.trim()
          : step.kind,
      ),
    ).toEqual(["sortBy()", "keyOf() via sortBy", "render()"]);
  });
});

describe("--function", () => {
  const graph = buildCodeGraph(
    new Workspace(
      [
        facts(
          `
          async function handler(input) { return input; }
          export default handler;
        `,
          "src/bookings/handleCancelBooking.ts",
        ),
        facts(`export default async function handler(req) { return req; }`, "src/api/signup.ts"),
        facts(`export default function () { return 1; }`, "src/lib/slugify/index.ts"),
        facts(
          `
          import cancel from "../bookings/handleCancelBooking";
          export { default as signupHandler } from "./signup";
          export async function POST(req) { return cancel(req); }
        `,
          "src/api/cancel.ts",
        ),
      ],
      "/repo",
    ),
  );
  const seeds = (fn: string) =>
    seedsForTarget(graph, { function: fn }, "/repo").map((id) => {
      const node = graph.nodes.get(id);
      return `${node?.file}#${node?.name}`;
    });
  const failure = (fn: string): NoFlowFoundError | undefined => {
    try {
      seeds(fn);
    } catch (error) {
      if (error instanceof NoFlowFoundError) return error;
    }
    return undefined;
  };

  it("stops and lists the matches when a name is defined in several files", () => {
    const error = failure("handler");
    expect(error?.message).toBe('"handler" matches functions in 2 files.');
    expect(error?.suggestions).toEqual([
      "handler() (src/api/signup.ts:1)",
      "handler() (src/bookings/handleCancelBooking.ts:2)",
      "Pick one with --function <file>#<name>, e.g. --function src/api/signup.ts#handler",
    ]);
  });

  it("accepts file#name", () => {
    expect(seeds("src/bookings/handleCancelBooking.ts#handler")).toEqual([
      "src/bookings/handleCancelBooking.ts#handler",
    ]);
    expect(seeds("./src/api/signup.ts#handler()")).toEqual(["src/api/signup.ts#handler"]);
    expect(failure("src/api/signup.ts#cancel")?.message).toBe(
      'No function named "cancel" was found in src/api/signup.ts.',
    );
  });

  it("finds a default export by its file name and the names it is imported under", () => {
    expect(seeds("handleCancelBooking")).toEqual(["src/bookings/handleCancelBooking.ts#handler"]);
    expect(seeds("cancel")).toEqual(["src/bookings/handleCancelBooking.ts#handler"]);
    expect(seeds("signupHandler")).toEqual(["src/api/signup.ts#handler"]);
    expect(seeds("slugify")).toEqual(["src/lib/slugify/index.ts#Slugify"]);
  });
});

describe("Express routers created and mounted in one expression", () => {
  it("records each link of the chain under the name it is bound to", () => {
    const workspace = new Workspace(
      [
        facts(
          `
          import { Router } from "express";
          const router = Router();
          router.post("/users/login", (req, res) => res.json({}));
          export default router;
        `,
          "src/routes/auth.controller.ts",
        ),
        facts(
          `
          import express from "express";
          export default express.Router().get("/tags", (req, res) => res.json([]));
        `,
          "src/routes/tag.controller.ts",
        ),
        facts(
          `
          import { Router } from "express";
          import tagsController from "./tag.controller";
          import authController from "./auth.controller";
          const api = Router()
            .use(tagsController)
            .use(authController);
          export default Router().use("/api", api);
        `,
          "src/routes/routes.ts",
        ),
        facts(
          `
          import express from "express";
          import routes from "./routes/routes";
          const app = express();
          app.use(routes);
        `,
          "src/main.ts",
        ),
      ],
      "/repo",
    );
    expect(composeRoutes(workspace).map(routeLabel)).toEqual([
      "POST /api/users/login",
      "GET /api/tags",
    ]);
    expect(
      seedsForTarget(buildCodeGraph(workspace), { route: "POST /api/users/login" }, "/repo"),
    ).toEqual(["route:POST /api/users/login"]);
  });
});

describe("Express middleware created by a package", () => {
  it("is a step before the handler", () => {
    const graph = buildCodeGraph(
      new Workspace(
        [
          facts(
            `
            import { expressjwt as jwt } from "express-jwt";
            const auth = { required: jwt({ secret: "s", algorithms: ["HS256"] }) };
            export default auth;
          `,
            "src/auth.ts",
          ),
          facts(
            `
            import { Router } from "express";
            import auth from "./auth";
            const router = Router();
            function feed(req, res) { res.json([]); }
            router.get("/articles/feed", auth.required, feed);
            export default router;
          `,
            "src/articles.ts",
          ),
        ],
        "/repo",
      ),
    );
    expect(
      graph
        .out("route:GET /articles/feed")
        .map((edge) => [
          edge.label,
          graph.nodes.get(edge.to)?.label,
          graph.nodes.get(edge.to)?.metadata.package,
        ]),
    ).toEqual([
      ["middleware", "auth.required", "express-jwt"],
      [undefined, "feed()", undefined],
    ]);
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
