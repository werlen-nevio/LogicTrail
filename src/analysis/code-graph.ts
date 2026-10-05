import path from "node:path";
import type { LogicEdgeType, LogicNodeType } from "../graph/model.js";
import type { ExitFact, FileFacts, HandlerRef, Step, SymbolFact } from "../indexer/facts.js";
import {
  classifyCall,
  frameworkAdapters,
  type Classification,
  type FrameworkAdapter,
} from "./adapters/index.js";
import { composeRoutes, RouteMatcher, type RouteDefinition } from "./routes.js";
import type { Value, Workspace } from "./workspace.js";
import { asText } from "../util/text.js";

export type CodeNodeKind =
  "symbol" | "route" | "database" | "external" | "library" | "event" | "navigation";

export interface CodeNode {
  id: string;
  kind: CodeNodeKind;
  type: LogicNodeType;
  label: string;
  /** Plain identifier-ish name used for retrieval and lookups. */
  name: string;
  file?: string;
  line?: number;
  endLine?: number;
  symbol?: SymbolFact;
  metadata: Record<string, unknown>;
}

export interface CodeEdge {
  from: string;
  to: string;
  kind: LogicEdgeType;
  label?: string;
  file: string;
  line: number;
  text: string;
  confidence: number;
  /** Set for relationships that are inferred rather than proven by a call site. */
  inferred?: { reason: string };
}

export type ResolvedStep =
  | { kind: "edge"; edge: CodeEdge }
  | { kind: "exit"; exit: ExitFact; file: string }
  | { kind: "branch"; line: number; test: string; file: string; arms: ResolvedArm[] }
  | { kind: "catch"; line: number; param?: string; file: string; steps: ResolvedStep[] };

export interface ResolvedArm {
  label: string;
  steps: ResolvedStep[];
  terminates: boolean;
}

/**
 * The repository-wide graph produced by static analysis. Nodes are code
 * symbols plus "virtual" nodes for routes, database operations, external
 * services, events, etc. Each node keeps its ordered, branch-aware steps.
 */
export class CodeGraph {
  readonly nodes = new Map<string, CodeNode>();
  readonly steps = new Map<string, ResolvedStep[]>();
  readonly outgoing = new Map<string, CodeEdge[]>();
  readonly incoming = new Map<string, CodeEdge[]>();
  readonly frameworks = new Set<string>();
  /** Heuristically inferred edges (also present in outgoing/incoming). */
  readonly inferredEdges: CodeEdge[] = [];
  routes: RouteDefinition[] = [];

  get edgeCount(): number {
    let count = 0;
    for (const edges of this.outgoing.values()) count += edges.length;
    return count;
  }

  out(id: string): readonly CodeEdge[] {
    return this.outgoing.get(id) ?? [];
  }

  in(id: string): readonly CodeEdge[] {
    return this.incoming.get(id) ?? [];
  }
}

export function symbolNodeId(file: string, symbolId: string): string {
  return `${file}#${symbolId}`;
}

export interface BuildCodeGraphOptions {
  adapters?: readonly FrameworkAdapter[];
}

export function buildCodeGraph(
  workspace: Workspace,
  options: BuildCodeGraphOptions = {},
): CodeGraph {
  return new CodeGraphBuilder(workspace, options.adapters ?? frameworkAdapters).build();
}

class CodeGraphBuilder {
  private readonly graph = new CodeGraph();
  private matcher = new RouteMatcher([]);

  constructor(
    private readonly workspace: Workspace,
    private readonly adapters: readonly FrameworkAdapter[],
  ) {}

  build(): CodeGraph {
    const files = [...this.workspace.files.values()];
    for (const file of files) {
      for (const symbol of file.symbols) {
        if (symbol.kind !== "class") this.addSymbolNode(file, symbol);
      }
    }
    this.addRoutes();
    this.addListeners(files);
    this.addPages(files);
    for (const file of files) {
      for (const symbol of file.symbols) {
        if (symbol.kind === "class") continue;
        const id = symbolNodeId(file.path, symbol.id);
        this.graph.steps.set(id, this.resolveSteps(file.path, symbol, symbol.steps));
      }
    }
    this.indexEdges();
    this.inferWebhookEdges();
    return this.graph;
  }

  /**
   * Third-party services call back into the app through webhooks, which no
   * call site proves. When a route's handler verifies a service's webhooks
   * (e.g. Stripe `webhooks.constructEvent`) or the route path names the
   * service, the service's other operations get an inferred edge to it.
   */
  private inferWebhookEdges(): void {
    const externals = [...this.graph.nodes.values()].filter((node) => node.kind === "external");
    const isWebhookOp = (operation: unknown): boolean => /webhook/i.test(asText(operation));
    for (const route of this.graph.routes) {
      const services = new Set<string>();
      const visit = (id: string, depth: number): void => {
        for (const edge of this.graph.out(id)) {
          const target = this.graph.nodes.get(edge.to);
          if (!target) continue;
          if (target.kind === "external" && isWebhookOp(target.metadata.operation)) {
            services.add(asText(target.metadata.service));
          } else if (target.kind === "symbol" && depth < 2) {
            visit(target.id, depth + 1);
          }
        }
      };
      visit(route.id, 0);
      if (/webhook/i.test(route.path)) {
        const segments = route.path.toLowerCase().split("/");
        for (const node of externals) {
          const service = asText(node.metadata.service);
          if (segments.includes(service.toLowerCase())) services.add(service);
        }
      }
      for (const service of services) {
        for (const node of externals) {
          if (node.metadata.service !== service || isWebhookOp(node.metadata.operation)) continue;
          const edge: CodeEdge = {
            from: node.id,
            to: route.id,
            kind: "triggers",
            label: "webhook",
            file: route.file,
            line: route.line,
            text: route.text,
            confidence: 0.6,
            inferred: {
              reason: `${service} delivers webhook events to ${route.method} ${route.path}, whose handler processes ${service} webhooks.`,
            },
          };
          this.graph.inferredEdges.push(edge);
          push(this.graph.outgoing, edge.from, edge);
          push(this.graph.incoming, edge.to, edge);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Nodes

  private addSymbolNode(file: FileFacts, symbol: SymbolFact): void {
    const id = symbolNodeId(file.path, symbol.id);
    const displayName =
      symbol.name === "default" ? defaultExportName(file.path, symbol) : symbol.name;
    const ownerPrefix = symbol.scope === "member" && symbol.owner ? `${symbol.owner}.` : "";
    const label =
      symbol.kind === "component"
        ? displayName
        : symbol.kind === "handler"
          ? `${displayName} handler`
          : `${ownerPrefix}${displayName}()`;
    this.graph.nodes.set(id, {
      id,
      kind: "symbol",
      type: symbolType(file.path, symbol),
      label,
      name: displayName,
      file: file.path,
      line: symbol.line,
      endLine: symbol.endLine,
      symbol,
      metadata: {
        symbolKind: symbol.kind,
        qualifiedName: symbol.qualifiedName,
        signature: symbol.signature,
        async: symbol.async,
        ...(symbol.parent ? { parent: symbol.parent } : {}),
        ...(symbol.envVars.length > 0 ? { envVars: symbol.envVars } : {}),
        ...(file.directives.length > 0 ? { directives: file.directives } : {}),
      },
    });
  }

  private ensureNode(node: CodeNode): string {
    if (!this.graph.nodes.has(node.id)) this.graph.nodes.set(node.id, node);
    return node.id;
  }

  private addRoutes(): void {
    const routes = composeRoutes(this.workspace);
    this.graph.routes = routes;
    this.matcher = new RouteMatcher(routes);
    for (const route of routes) {
      this.graph.frameworks.add(frameworkLabel(route.framework));
      this.graph.nodes.set(route.id, {
        id: route.id,
        kind: "route",
        type: "route",
        label: `${route.method} ${route.path}`,
        name: route.path,
        file: route.file,
        line: route.line,
        metadata: { method: route.method, path: route.path, framework: route.framework },
      });
      const steps: ResolvedStep[] = [];
      for (const handler of route.handlers) {
        const target = this.resolveHandler(handler.file, handler.ref);
        if (!target) continue;
        const targetNode = this.graph.nodes.get(target);
        if (targetNode?.symbol?.kind === "handler" && !handler.middleware) {
          targetNode.label = `${route.method} ${route.path} handler`;
        }
        steps.push({
          kind: "edge",
          edge: {
            from: route.id,
            to: target,
            kind: "calls",
            ...(handler.middleware ? { label: "middleware" } : {}),
            file: handler.file,
            line:
              route.file === handler.file
                ? route.line
                : (this.graph.nodes.get(target)?.line ?? route.line),
            text: route.text,
            confidence: 1,
          },
        });
      }
      this.graph.steps.set(route.id, steps);
    }
  }

  private addListeners(files: readonly FileFacts[]): void {
    for (const file of files) {
      for (const listener of file.listeners) {
        const target = this.resolveHandler(file.path, listener.handler);
        if (!target) continue;
        const eventId = this.eventNode(listener.channel, listener.event);
        const steps = this.graph.steps.get(eventId) ?? [];
        steps.push({
          kind: "edge",
          edge: {
            from: eventId,
            to: target,
            kind: "triggers",
            label: listener.channel === "queue" ? "worker" : "listener",
            file: file.path,
            line: listener.line,
            text: listener.text,
            confidence: 1,
          },
        });
        this.graph.steps.set(eventId, steps);
      }
    }
  }

  private addPages(files: readonly FileFacts[]): void {
    for (const file of files) {
      for (const page of file.pages) {
        const target = this.resolveHandler(file.path, page.component);
        const node = target ? this.graph.nodes.get(target) : undefined;
        if (!node) continue;
        const pages = (node.metadata.pages as string[] | undefined) ?? [];
        if (!pages.includes(page.path)) pages.push(page.path);
        node.metadata.pages = pages;
        this.graph.frameworks.add(frameworkLabel(page.framework));
      }
    }
  }

  private eventNode(channel: "event" | "queue", event: string): string {
    return this.ensureNode({
      id: `event:${channel}:${event}`,
      kind: "event",
      type: "event",
      label: channel === "queue" ? `${event} queue` : event,
      name: event,
      metadata: { channel, event },
    });
  }

  private resolveHandler(file: string, ref: HandlerRef): string | undefined {
    if (ref.kind === "symbol") {
      const id = symbolNodeId(file, ref.symbol);
      return this.graph.nodes.has(id) ? id : undefined;
    }
    const value = this.workspace.resolvePath(file, undefined, ref.path);
    return this.symbolTarget(value);
  }

  private symbolTarget(value: Value): string | undefined {
    if (value.kind !== "symbol" || value.symbol.kind === "class") return undefined;
    const id = symbolNodeId(value.file, value.symbol.id);
    return this.graph.nodes.has(id) ? id : undefined;
  }

  // ---------------------------------------------------------------------------
  // Steps

  private resolveSteps(file: string, symbol: SymbolFact, steps: readonly Step[]): ResolvedStep[] {
    const self = symbolNodeId(file, symbol.id);
    const resolved: ResolvedStep[] = [];
    for (const step of steps) {
      switch (step.kind) {
        case "call": {
          const edge = this.resolveCall(file, symbol, self, step.call);
          if (edge) resolved.push({ kind: "edge", edge });
          break;
        }
        case "ref": {
          const { ref } = step;
          const target = this.symbolTarget(this.workspace.resolvePath(file, symbol, ref.path));
          if (!target || target === self) break;
          const targetNode = this.graph.nodes.get(target);
          const isRender = ref.context === "jsx-element";
          if (isRender && targetNode?.type !== "component") break;
          const label = isRender
            ? undefined
            : (ref.name ?? (ref.callee ? `via ${ref.callee}` : undefined));
          resolved.push({
            kind: "edge",
            edge: {
              from: self,
              to: target,
              kind: isRender ? "renders" : "calls",
              ...(label ? { label } : {}),
              file,
              line: ref.line,
              text: ref.text,
              confidence: 1,
            },
          });
          break;
        }
        case "exit":
          resolved.push({ kind: "exit", exit: step.exit, file });
          break;
        case "branch": {
          const arms = step.arms.map((arm) => ({
            label: arm.label,
            steps: this.resolveSteps(file, symbol, arm.steps),
            terminates: arm.terminates,
          }));
          if (arms.some((arm) => arm.steps.length > 0)) {
            resolved.push({ kind: "branch", line: step.line, test: step.test, file, arms });
          }
          break;
        }
        case "catch": {
          const inner = this.resolveSteps(file, symbol, step.steps);
          if (inner.length > 0) {
            resolved.push({
              kind: "catch",
              line: step.line,
              file,
              steps: inner,
              ...(step.param ? { param: step.param } : {}),
            });
          }
          break;
        }
      }
    }
    return resolved;
  }

  private resolveCall(
    file: string,
    symbol: SymbolFact,
    self: string,
    call: Extract<Step, { kind: "call" }>["call"],
  ): CodeEdge | undefined {
    const value = this.workspace.resolvePath(file, symbol, call.path);
    const base = {
      from: self,
      file,
      line: call.line,
      text: call.text,
      ...(call.via ? { label: call.via } : call.inLoop ? { label: "for each" } : {}),
    };
    const target = this.symbolTarget(value);
    if (target) {
      if (target === self) return undefined;
      return { ...base, to: target, kind: "calls", confidence: 1 };
    }
    const classified = classifyCall(
      { file, symbol, call, value, workspace: this.workspace },
      this.adapters,
    );
    if (!classified) return undefined;
    this.graph.frameworks.add(classified.adapter);
    return this.classificationEdge(classified.classification, base);
  }

  private classificationEdge(
    classification: Classification,
    base: { from: string; file: string; line: number; text: string; label?: string },
  ): CodeEdge | undefined {
    switch (classification.kind) {
      case "database": {
        const subject = classification.model ?? classification.system;
        const id = this.ensureNode({
          id: `db:${classification.system}:${classification.model ?? "*"}:${classification.operation}`,
          kind: "database",
          type: "database",
          label: `${subject}.${classification.operation}`,
          name: subject,
          metadata: {
            system: classification.system,
            ...(classification.model ? { model: classification.model } : {}),
            operation: classification.operation,
            access: classification.access,
          },
        });
        return {
          ...base,
          to: id,
          kind: classification.access === "read" ? "reads" : "writes",
          confidence: 1,
        };
      }
      case "external": {
        const id = this.ensureNode({
          id: `ext:${classification.service}:${classification.operation}`,
          kind: "external",
          type: "external",
          label: `${classification.service}: ${classification.operation}`,
          name: classification.service,
          metadata: {
            service: classification.service,
            operation: classification.operation,
            ...(classification.package ? { package: classification.package } : {}),
          },
        });
        return { ...base, to: id, kind: "calls", confidence: 1 };
      }
      case "library": {
        const id = this.ensureNode({
          id: `lib:${classification.package}:${classification.label}`,
          kind: "library",
          type: "library",
          label: classification.label,
          name: classification.label,
          metadata: {
            package: classification.package,
            operation: classification.operation,
            category: classification.category,
          },
        });
        return { ...base, to: id, kind: "calls", confidence: 1 };
      }
      case "request": {
        const { url, method } = classification;
        if (url.path && !url.host) {
          const match = this.matcher.match(method, url.path, url.unknownPrefix);
          if (match) {
            return { ...base, to: match.route.id, kind: "requests", confidence: match.confidence };
          }
        }
        const display = url.host ? `${url.host}${url.path ?? ""}` : (url.path ?? url.raw);
        const id = this.ensureNode({
          id: `http:${method} ${display}`,
          kind: "external",
          type: "external",
          label: `${method} ${display}`,
          name: display,
          metadata: {
            service: url.host ?? "HTTP",
            method,
            url: url.raw,
            client: classification.client,
            unmatched: !url.host,
          },
        });
        return { ...base, to: id, kind: "requests", confidence: url.host ? 1 : 0.7 };
      }
      case "emit": {
        const id = this.eventNode(classification.channel, classification.event);
        const node = this.graph.nodes.get(id);
        if (node) node.metadata.system = classification.system;
        return {
          ...base,
          to: id,
          kind: "emits",
          ...(classification.detail ? { label: classification.detail } : {}),
          confidence: classification.confidence,
        };
      }
      case "navigate": {
        const id = this.ensureNode({
          id: `nav:${classification.to}`,
          kind: "navigation",
          type: "route",
          label: `navigate ${classification.to}`,
          name: classification.to,
          metadata: {
            navigation: true,
            path: classification.to,
            framework: classification.framework,
          },
        });
        return { ...base, to: id, kind: "navigates", confidence: 1 };
      }
    }
  }

  private indexEdges(): void {
    const seen = new Set<string>();
    const visit = (steps: readonly ResolvedStep[]): void => {
      for (const step of steps) {
        if (step.kind === "edge") {
          const key = `${step.edge.from}\0${step.edge.to}\0${step.edge.kind}`;
          if (seen.has(key)) continue;
          seen.add(key);
          push(this.graph.outgoing, step.edge.from, step.edge);
          push(this.graph.incoming, step.edge.to, step.edge);
        } else if (step.kind === "branch") {
          for (const arm of step.arms) visit(arm.steps);
        } else if (step.kind === "catch") {
          visit(step.steps);
        }
      }
    };
    for (const steps of this.graph.steps.values()) visit(steps);
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function symbolType(file: string, symbol: SymbolFact): LogicNodeType {
  if (symbol.kind === "component") return "component";
  const lower = file.toLowerCase();
  if (/(^|\/)services?\//.test(lower) || /service\.[cm]?[jt]sx?$/.test(lower)) return "service";
  if (symbol.owner && /Service$/.test(symbol.owner)) return "service";
  return "function";
}

/** A readable name for an anonymous default export, derived from its file. */
export function defaultExportName(file: string, symbol: SymbolFact): string {
  const stem = path.posix.basename(file).replace(/\.[^.]+$/, "");
  const directory = path.posix.basename(path.posix.dirname(file));
  const pascal = (text: string): string =>
    text
      .replace(/[[\]().@]/g, "")
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join("");
  if (["page", "layout", "route", "index"].includes(stem)) {
    return `${pascal(directory) || "Root"}${stem === "index" ? "" : pascal(stem)}`;
  }
  return symbol.kind === "component" || symbol.returnsJsx ? pascal(stem) : `${stem}.default`;
}

function frameworkLabel(framework: string): string {
  switch (framework) {
    case "next-app":
    case "next-pages":
      return "next.js";
    case "react-router":
      return "react-router";
    case "generic":
      return "http";
    default:
      return framework;
  }
}
