import type {
  HandlerRef,
  MountFact,
  NestAppFact,
  RouteFact,
  VersionRef,
} from "../indexer/facts.js";
import type { Workspace } from "./workspace.js";

export interface RouteHandlerRef {
  ref: HandlerRef;
  /** File in which `ref` must be resolved. */
  file: string;
  middleware: boolean;
}

export interface RouteDefinition {
  id: string;
  method: string;
  path: string;
  framework: RouteFact["framework"];
  file: string;
  line: number;
  text: string;
  handlers: RouteHandlerRef[];
  /**
   * NestJS versions served at this path when the version isn't in the URL (header, media type or
   * custom versioning).
   */
  versions?: string[];
  /** False when a request without a version doesn't reach this route (it has other versions). */
  servesDefault?: boolean;
}

/** "POST /v2/bookings", plus " (version 2024-08-13)" when the version isn't in the path. */
export function routeLabel(route: Pick<RouteDefinition, "method" | "path" | "versions">): string {
  const versions = route.versions ?? [];
  const suffix =
    versions.length === 0
      ? ""
      : ` (${versions.length === 1 ? "version" : "versions"} ${versions.join(", ")})`;
  return `${route.method} ${route.path}${suffix}`;
}

interface Mounting {
  prefix: string;
  middleware: RouteHandlerRef[];
}

interface MountEdge {
  mount: MountFact;
  file: string;
  parentKey: string | undefined;
  middleware: RouteHandlerRef[];
}

interface RouterMiddleware {
  file: string;
  line: number;
  refs: RouteHandlerRef[];
}

const ROOT: Mounting = { prefix: "", middleware: [] };

export function joinPaths(...parts: string[]): string {
  const segments = parts.flatMap((part) => part.split("/")).filter((segment) => segment.length > 0);
  return `/${segments.join("/")}`;
}

/**
 * Computes the full URL of every route: Express-style mount prefixes are
 * composed across files (`app.use("/api", api)` + `api.use("/auth", auth)` +
 * `auth.post("/login")` = `POST /api/auth/login`) and middleware attached at
 * mount points is prepended to each route's handler chain. Fastify plugins,
 * Hono sub-apps and Koa routers compose the same way, and NestJS controller
 * routes get the app's global prefix.
 */
export function composeRoutes(workspace: Workspace): RouteDefinition[] {
  const routerKey = (
    file: string,
    path: readonly string[] | undefined,
    owner?: string,
  ): string | undefined => {
    // A router received as a function parameter is keyed by that function (Fastify plugins).
    if (owner) return `${file}#${owner}`;
    if (!path || path.length === 0) return undefined;
    if (path.length === 1 && path[0]) {
      const definition = workspace.locateDefinition(file, path[0]);
      if (definition) return `${definition.file}#${definition.name}`;
    }
    return `${file}#local:${path.join(".")}`;
  };
  const targetKey = (file: string, target: HandlerRef): string | undefined => {
    if (target.kind === "symbol") return `${file}#${target.symbol}`;
    return target.kind === "path" ? routerKey(file, target.path) : undefined;
  };

  const knownRouters = new Set<string>();
  for (const [file, facts] of workspace.files) {
    for (const route of facts.routes) {
      const routeKey = routerKey(file, route.router, route.routerOwner);
      if (routeKey) knownRouters.add(routeKey);
    }
    for (const mount of facts.mounts) {
      const mountKey = routerKey(file, mount.router, mount.routerOwner);
      if (mountKey) knownRouters.add(mountKey);
    }
  }

  const mountsByTarget = new Map<string, MountEdge[]>();
  const routerMiddleware = new Map<string, RouterMiddleware[]>();
  const basePaths = new Map<string, string>();
  for (const [file, facts] of workspace.files) {
    for (const mount of facts.mounts) {
      const parentKey = routerKey(file, mount.router, mount.routerOwner);
      if (mount.kind === "base-path") {
        if (parentKey) basePaths.set(parentKey, mount.prefix);
        continue;
      }
      const pendingMiddleware: RouteHandlerRef[] = [];
      let mountedRouter = false;
      for (const target of mount.targets) {
        const childKey = targetKey(file, target);
        if (childKey && knownRouters.has(childKey) && childKey !== parentKey) {
          const edges = mountsByTarget.get(childKey) ?? [];
          edges.push({ mount, file, parentKey, middleware: [...pendingMiddleware] });
          mountsByTarget.set(childKey, edges);
          mountedRouter = true;
        } else if (mount.kind !== "register") {
          pendingMiddleware.push({ ref: target, file, middleware: true });
        }
      }
      if (!mountedRouter && mount.prefix === "" && parentKey && mount.kind !== "register") {
        const list = routerMiddleware.get(parentKey) ?? [];
        list.push({ file, line: mount.line, refs: pendingMiddleware });
        routerMiddleware.set(parentKey, list);
      }
    }
  }

  const middlewareBefore = (
    key: string | undefined,
    file: string,
    line: number,
  ): RouteHandlerRef[] => {
    if (!key) return [];
    return (routerMiddleware.get(key) ?? [])
      .filter((entry) => entry.file === file && entry.line < line)
      .flatMap((entry) => entry.refs);
  };

  const memo = new Map<string, Mounting[]>();
  const mountings = (key: string, seen: ReadonlySet<string>): Mounting[] => {
    const cached = memo.get(key);
    if (cached) return cached;
    if (seen.has(key)) return [ROOT];
    const edges = mountsByTarget.get(key) ?? [];
    const nextSeen = new Set(seen).add(key);
    let result: Mounting[] = edges.length === 0 ? [ROOT] : [];
    for (const edge of edges) {
      const parents = edge.parentKey ? mountings(edge.parentKey, nextSeen) : [ROOT];
      const inherited = middlewareBefore(edge.parentKey, edge.file, edge.mount.line);
      for (const parent of parents) {
        result.push({
          prefix: joinPaths(parent.prefix, edge.mount.prefix),
          middleware: [...parent.middleware, ...inherited, ...edge.middleware],
        });
      }
    }
    // The router's own base path (Hono `basePath`, Koa `prefix`) comes after its mount prefix.
    const base = basePaths.get(key);
    if (base)
      result = result.map((mounting) => ({
        ...mounting,
        prefix: joinPaths(mounting.prefix, base),
      }));
    memo.set(key, result);
    return result;
  };

  const nest = nestPlacements(workspace);
  const definitions: RouteDefinition[] = [];
  const usedIds = new Set<string>();
  const add = (definition: Omit<RouteDefinition, "id">): void => {
    let id = `route:${routeLabel(definition)}`;
    if (usedIds.has(id)) id = `${id} (${definition.file}:${definition.line})`;
    usedIds.add(id);
    definitions.push({ id, ...definition });
  };

  for (const [file, facts] of workspace.files) {
    for (const route of facts.routes) {
      const own = route.handlers.map((ref, index) => ({
        ref,
        file,
        middleware: index < route.handlers.length - 1,
      }));
      if (route.framework === "nestjs") {
        for (const placement of nest(file, route)) {
          add({
            method: route.method,
            path: placement.path,
            framework: route.framework,
            file,
            line: route.line,
            text: route.text,
            handlers: own,
            ...(placement.versions ? { versions: placement.versions } : {}),
            ...(placement.servesDefault ? {} : { servesDefault: false }),
          });
        }
        continue;
      }
      if (!route.router) {
        add({
          method: route.method,
          path: route.path,
          framework: route.framework,
          file,
          line: route.line,
          text: route.text,
          handlers: own,
        });
        continue;
      }
      const key = routerKey(file, route.router, route.routerOwner);
      const routerLevel = middlewareBefore(key, file, route.line);
      for (const mounting of key ? mountings(key, new Set()) : [ROOT]) {
        add({
          method: route.method,
          path: joinPaths(mounting.prefix, route.path),
          framework: route.framework,
          file,
          line: route.line,
          text: route.text,
          handlers: [...mounting.middleware, ...routerLevel, ...own],
        });
      }
    }
  }
  return definitions;
}

interface NestPlacement {
  path: string;
  versions?: string[];
  servesDefault: boolean;
}

interface NestApp {
  fact: NestAppFact;
  file: string;
  /** Controllers in the app's module tree; undefined when the tree isn't known. */
  controllers?: Set<string>;
}

const NEUTRAL = "\0neutral";

/**
 * Where NestJS controller routes are served: the app's global prefix (unless excluded), the
 * version when it is in the URL, the RouterModule path of the controller's module, then the
 * controller and method paths. Prefix and versioning apply to the controllers of the app whose
 * module tree contains them, or to every controller when that tree can't be followed.
 */
function nestPlacements(workspace: Workspace): (file: string, route: RouteFact) => NestPlacement[] {
  const refKey = (file: string, ref: HandlerRef): string | undefined => {
    if (ref.kind === "symbol") return `${file}#${ref.symbol}`;
    const [head, ...rest] = ref.path;
    if (!head || rest.length > 0) return undefined;
    const definition = workspace.locateDefinition(file, head);
    return definition ? `${definition.file}#${definition.name}` : undefined;
  };

  const modules = new Map<string, { imports: string[]; controllers: string[] }>();
  const controllerModules = new Map<string, string[]>();
  const routerPaths = new Map<string, string>();
  const apps: NestApp[] = [];
  for (const [file, facts] of workspace.files) {
    if (!facts.nest) continue;
    for (const module of facts.nest.modules) {
      const key = `${file}#${module.symbol}`;
      const controllers = module.controllers.flatMap((ref) => refKey(file, ref) ?? []);
      modules.set(key, {
        imports: module.imports.flatMap((ref) => refKey(file, ref) ?? []),
        controllers,
      });
      for (const controller of controllers) {
        controllerModules.set(controller, [...(controllerModules.get(controller) ?? []), key]);
      }
    }
    for (const entry of facts.nest.routerPaths) {
      const key = refKey(file, entry.module);
      if (key && !routerPaths.has(key)) routerPaths.set(key, entry.path);
    }
    for (const app of facts.nest.apps) {
      // An app that is only created, not configured, changes no paths.
      if (app.globalPrefix || app.versioning) apps.push({ fact: app, file });
    }
  }
  for (const app of apps) {
    const root = app.fact.module && refKey(app.file, app.fact.module);
    if (!root || !modules.has(root)) continue;
    const controllers = new Set<string>();
    const seen = new Set<string>();
    const queue = [root];
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      if (seen.has(key)) continue;
      seen.add(key);
      const module = modules.get(key);
      for (const controller of module?.controllers ?? []) controllers.add(controller);
      queue.push(...(module?.imports ?? []));
    }
    app.controllers = controllers;
  }

  const version = (file: string, ref: VersionRef): string => {
    if (ref.kind === "string") return ref.value;
    if (ref.kind === "neutral") return NEUTRAL;
    const value = workspace.resolvePath(file, undefined, ref.path);
    return value.kind === "string" ? value.value : ref.path.join(".");
  };

  return (file, route) => {
    const controller = route.controller ? `${file}#${route.controller}` : undefined;
    const module = controller ? controllerModules.get(controller)?.[0] : undefined;
    const routePath = joinPaths((module && routerPaths.get(module)) ?? "", route.path);
    const applicable = apps.filter(
      (app) => !app.controllers || (controller !== undefined && app.controllers.has(controller)),
    );
    if (applicable.length === 0) return [{ path: routePath, servesDefault: true }];

    const placements = new Map<string, NestPlacement>();
    for (const { fact, file: appFile } of applicable) {
      const prefix = fact.globalPrefix;
      const excluded = prefix?.exclude.some(
        (entry) =>
          (!entry.method || entry.method === route.method) && pathMatches(entry.path, routePath),
      );
      const base = prefix && !excluded ? prefix.prefix : "";
      const versioning = fact.versioning;
      if (!versioning) {
        const path = joinPaths(base, routePath);
        placements.set(path, { path, servesDefault: true });
        continue;
      }
      const defaults = versioning.defaultVersions.map((ref) => version(appFile, ref));
      const versions = route.versions
        ? [...new Set(route.versions.map((ref) => version(file, ref)))]
        : defaults;
      if (versioning.type === "uri") {
        for (const value of versions.length > 0 ? versions : [NEUTRAL]) {
          const segment = value === NEUTRAL ? "" : `${versioning.prefix}${value}`;
          const path = joinPaths(base, segment, routePath);
          placements.set(path, { path, servesDefault: true });
        }
        continue;
      }
      const path = joinPaths(base, routePath);
      const neutral = versions.length === 0 || versions.includes(NEUTRAL);
      const placement: NestPlacement = {
        path,
        ...(neutral ? {} : { versions }),
        servesDefault: neutral || !route.versions || versions.some((v) => defaults.includes(v)),
      };
      placements.set(`${path} ${versions.join(",")}`, placement);
    }
    return [...placements.values()];
  };
}

/** Matches a `setGlobalPrefix` exclude path such as "health", "cats/:id" or "auth/(.*)". */
function pathMatches(pattern: string, path: string): boolean {
  const wanted = segmentsOf(pattern);
  const actual = segmentsOf(path);
  for (let index = 0; index < wanted.length; index++) {
    const segment = wanted[index] ?? "";
    if (segment === "*" || segment === "(.*)" || segment.endsWith("*")) return true;
    const value = actual[index];
    if (value === undefined) return false;
    if (!segment.startsWith(":") && !value.startsWith(":") && segment !== value) return false;
  }
  return wanted.length === actual.length;
}

export interface RouteMatch {
  route: RouteDefinition;
  confidence: number;
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function isParam(segment: string): boolean {
  return segment.startsWith(":") || segment === "*";
}

/** Returns the number of literal segment matches, or undefined if the paths do not match. */
function matchSegments(route: readonly string[], request: readonly string[]): number | undefined {
  let literal = 0;
  for (let index = 0; index < route.length; index++) {
    const routeSegment = route[index] ?? "";
    if (routeSegment.endsWith("*")) return request.length >= index ? literal : undefined;
    const requestSegment = request[index];
    if (requestSegment === undefined) return undefined;
    if (isParam(routeSegment) || isParam(requestSegment)) continue;
    if (routeSegment !== requestSegment) return undefined;
    literal++;
  }
  return request.length === route.length ? literal : undefined;
}

/** Matches client-side requests (fetch/axios URLs) to server route definitions. */
export class RouteMatcher {
  private readonly routes: { definition: RouteDefinition; segments: string[] }[];

  constructor(routes: readonly RouteDefinition[]) {
    this.routes = routes.map((definition) => ({
      definition,
      segments: segmentsOf(definition.path),
    }));
  }

  match(method: string, path: string, unknownPrefix: boolean): RouteMatch | undefined {
    const request = segmentsOf(path);
    const compatible = this.routes.filter(({ definition }) => {
      const routeMethod = definition.method.toUpperCase();
      return routeMethod === "ANY" || routeMethod === "ALL" || routeMethod === method.toUpperCase();
    });

    let best: { definition: RouteDefinition; score: number } | undefined;
    for (const route of compatible) {
      const score = matchSegments(route.segments, request);
      if (score !== undefined && (!best || score > best.score))
        best = { definition: route.definition, score };
    }
    if (best && (best.score > 0 || request.length === 0)) {
      return { route: best.definition, confidence: unknownPrefix ? 0.8 : 0.95 };
    }

    // Suffix match: the client URL is missing a base path (axios baseURL, env-based prefixes).
    if (request.length === 0) return undefined;
    let suffix: { definition: RouteDefinition; score: number } | undefined;
    for (const route of compatible) {
      if (route.segments.length <= request.length) continue;
      const tail = route.segments.slice(route.segments.length - request.length);
      const score = matchSegments(tail, request);
      if (score !== undefined && score > 0 && (!suffix || score > suffix.score)) {
        suffix = { definition: route.definition, score };
      }
    }
    return suffix ? { route: suffix.definition, confidence: 0.65 } : undefined;
  }
}
