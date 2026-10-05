import type { CodeGraph, CodeNode } from "../analysis/code-graph.js";
import type { LogicNodeType } from "../graph/model.js";
import type { ExitFact } from "../indexer/facts.js";
import { asText } from "../util/text.js";

export const HTTP_STATUS_TEXT: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export function isErrorExit(exit: ExitFact): boolean {
  return exit.kind === "throw" || (exit.status !== undefined && exit.status >= 400);
}

export function exitType(exit: ExitFact): LogicNodeType {
  return isErrorExit(exit) ? "error" : "response";
}

export function exitLabel(exit: ExitFact): string {
  const status =
    exit.status !== undefined
      ? `${exit.status} ${HTTP_STATUS_TEXT[exit.status] ?? ""}`.trim()
      : undefined;
  switch (exit.kind) {
    case "throw":
      if (exit.errorName === "next(error)") return "next(error)";
      return status ?? `throw ${exit.errorName ?? "error"}`;
    case "redirect":
      return exit.target ? `redirect ${exit.target}` : (status ?? "redirect");
    case "response":
      return status ?? "200 OK";
  }
}

export function exitDescription(exit: ExitFact, owner: string): string {
  if (exit.kind === "throw") {
    const what = exit.errorName && exit.errorName !== "next(error)" ? exit.errorName : "an error";
    return exit.message
      ? `${owner} throws ${what}: "${exit.message}".`
      : `${owner} throws ${what}.`;
  }
  if (exit.kind === "redirect")
    return `${owner} redirects${exit.target ? ` to ${exit.target}` : ""}.`;
  return `${owner} responds${exit.status ? ` with HTTP ${exit.status}` : ""}.`;
}

/** Description of a code node derived from doc comments and code facts (no LLM). */
export function staticDescription(
  node: CodeNode,
  graph: CodeGraph,
): { text: string; source: "doc" | "static" } {
  const symbol = node.symbol;
  if (symbol?.doc) return { text: symbol.doc, source: "doc" };
  const metadata = node.metadata;
  switch (node.kind) {
    case "symbol": {
      const pages = metadata.pages as string[] | undefined;
      if (symbol?.kind === "component") {
        return {
          text: pages?.length
            ? `React component rendered for ${pages.join(", ")}.`
            : "React component.",
          source: "static",
        };
      }
      const route = graph.in(node.id).find((edge) => graph.nodes.get(edge.from)?.kind === "route");
      const routeLabel = route ? graph.nodes.get(route.from)?.label : undefined;
      if (routeLabel && route?.label !== "middleware") {
        return {
          text: `Handles ${routeLabel}. ${symbol?.signature ?? ""}`.trim(),
          source: "static",
        };
      }
      if (routeLabel) return { text: `Middleware for ${routeLabel}.`, source: "static" };
      return { text: symbol?.signature ?? node.label, source: "static" };
    }
    case "route": {
      if (metadata.navigation)
        return { text: `Client-side navigation to ${asText(metadata.path)}.`, source: "static" };
      const framework = asText(metadata.framework, "HTTP");
      return { text: `${framework} route ${node.label}.`, source: "static" };
    }
    case "navigation":
      return { text: `Client-side navigation to ${asText(metadata.path)}.`, source: "static" };
    case "database": {
      const target = metadata.model ? `${asText(metadata.model)}` : asText(metadata.system);
      const verb = metadata.access === "read" ? "Reads from" : "Writes to";
      return {
        text: `${verb} ${target} via ${asText(metadata.system)} (${asText(metadata.operation)}).`,
        source: "static",
      };
    }
    case "external":
      if (metadata.method) {
        return {
          text: `HTTP ${asText(metadata.method)} request to ${asText(metadata.url)}.`,
          source: "static",
        };
      }
      return {
        text: `Calls ${asText(metadata.service)}: ${asText(metadata.operation)}.`,
        source: "static",
      };
    case "library":
      return {
        text: `${capitalize(asText(metadata.category))} via ${asText(metadata.package)} (${asText(metadata.operation)}).`,
        source: "static",
      };
    case "event":
      return metadata.channel === "queue"
        ? { text: `Background job queue "${asText(metadata.event)}".`, source: "static" }
        : { text: `Event "${asText(metadata.event)}".`, source: "static" };
  }
}

function capitalize(text: string): string {
  return text ? text[0]?.toUpperCase() + text.slice(1) : text;
}
