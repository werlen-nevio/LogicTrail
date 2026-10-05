import type { HandlerRef, MountFact, RouteFact } from "../indexer/facts.js";
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
 * mount points is prepended to each route's handler chain.
 */
export function composeRoutes(workspace: Workspace): RouteDefinition[] {
  const routerKey = (file: string, path: readonly string[] | undefined): string | undefined => {
    if (!path || path.length === 0) return undefined;
    if (path.length === 1 && path[0]) {
      const definition = workspace.locateDefinition(file, path[0]);
      if (definition?.kind === "binding") return `${definition.file}#${definition.name}`;
    }
    return `${file}#local:${path.join(".")}`;
  };

  const knownRouters = new Set<string>();
  for (const [file, facts] of workspace.files) {
    for (const route of facts.routes) {
      const routeKey = routerKey(file, route.router);
      if (routeKey) knownRouters.add(routeKey);
    }
    for (const mount of facts.mounts) {
      const mountKey = routerKey(file, mount.router);
      if (mountKey) knownRouters.add(mountKey);
    }
  }

  const mountsByTarget = new Map<string, MountEdge[]>();
  const routerMiddleware = new Map<string, RouterMiddleware[]>();
  for (const [file, facts] of workspace.files) {
    for (const mount of facts.mounts) {
      const parentKey = routerKey(file, mount.router);
      const pendingMiddleware: RouteHandlerRef[] = [];
      let mountedRouter = false;
      for (const target of mount.targets) {
        const childKey = target.kind === "path" ? routerKey(file, target.path) : undefined;
        if (childKey && knownRouters.has(childKey) && childKey !== parentKey) {
          const edges = mountsByTarget.get(childKey) ?? [];
          edges.push({ mount, file, parentKey, middleware: [...pendingMiddleware] });
          mountsByTarget.set(childKey, edges);
          mountedRouter = true;
        } else {
          pendingMiddleware.push({ ref: target, file, middleware: true });
        }
      }
      if (!mountedRouter && mount.prefix === "" && parentKey) {
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
    const edges = mountsByTarget.get(key);
    if (!edges || edges.length === 0) return [ROOT];
    const nextSeen = new Set(seen).add(key);
    const result: Mounting[] = [];
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
    memo.set(key, result);
    return result;
  };

  const definitions: RouteDefinition[] = [];
  const usedIds = new Set<string>();
  const add = (definition: Omit<RouteDefinition, "id">): void => {
    let id = `route:${definition.method} ${definition.path}`;
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
      if (route.framework !== "express" && route.framework !== "generic") {
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
      const key = routerKey(file, route.router);
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
