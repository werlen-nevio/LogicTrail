import type { ArgFact, SymbolFact } from "../../indexer/facts.js";
import type { PackageValue, Workspace } from "../workspace.js";
import {
  isPackage,
  objectProp,
  packageValue,
  stringArg,
  type FrameworkAdapter,
  type UrlSpec,
} from "./types.js";

const ALL_METHODS = new Set(["get", "delete", "head", "options", "post", "put", "patch"]);

/** Turns a URL argument into a normalized {@link UrlSpec}. */
export function urlFromArg(
  arg: ArgFact | undefined,
  workspace: Workspace,
  file: string,
  scope: SymbolFact | undefined,
  baseUrl?: string,
): UrlSpec | undefined {
  if (!arg) return undefined;
  let raw: string | undefined;
  if (arg.kind === "string" || arg.kind === "template") raw = arg.value;
  else if (arg.kind === "path") {
    const value = workspace.resolvePath(file, scope, arg.path);
    if (value.kind === "string") raw = value.value;
  }
  if (raw === undefined) return undefined;
  if (arg.kind === "template") raw = substituteConstants(raw, workspace, file, scope);
  return normalizeUrl(raw, baseUrl);
}

/** Replaces `${CONSTANT}` with known string constants. */
function substituteConstants(
  raw: string,
  workspace: Workspace,
  file: string,
  scope: SymbolFact | undefined,
): string {
  return raw.replace(/\$\{([\w.]+)\}/g, (match, expression: string) => {
    const value = workspace.resolvePath(file, scope, expression.split("."));
    return value.kind === "string" ? value.value : match;
  });
}

export function normalizeUrl(raw: string, baseUrl?: string): UrlSpec {
  let text = raw.trim();
  let unknownPrefix = false;
  if (text.startsWith("${")) {
    const end = text.indexOf("}");
    text = end === -1 ? "" : text.slice(end + 1);
    unknownPrefix = true;
  }
  const absolute = /^https?:\/\/([^/]+)(\/[^?#]*)?/i.exec(text);
  if (absolute) {
    const host = absolute[1] ?? "";
    const pathPart = absolute[2] ?? "/";
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(host)) {
      return { raw, path: cleanPath(pathPart), unknownPrefix };
    }
    return {
      raw,
      host: host.replace(/\$\{[^}]*\}/g, ":param"),
      path: cleanPath(pathPart),
      unknownPrefix,
    };
  }
  let pathPart = text.split(/[?#]/)[0] ?? "";
  if (!pathPart.startsWith("/")) {
    if (pathPart === "") return { raw, unknownPrefix: true };
    pathPart = `/${pathPart}`;
    unknownPrefix = unknownPrefix || baseUrl === undefined;
  }
  if (baseUrl !== undefined && !/^https?:/i.test(raw)) {
    const base = normalizeUrl(baseUrl);
    if (base.host) {
      return {
        raw,
        host: base.host,
        path: cleanPath(joinUrl(base.path ?? "/", pathPart)),
        unknownPrefix: false,
      };
    }
    if (base.path)
      return {
        raw,
        path: cleanPath(joinUrl(base.path, pathPart)),
        unknownPrefix: base.unknownPrefix,
      };
  }
  return { raw, path: cleanPath(pathPart), unknownPrefix };
}

function joinUrl(base: string, child: string): string {
  return `${base.replace(/\/+$/, "")}/${child.replace(/^\/+/, "")}`;
}

function cleanPath(pathPart: string): string {
  const replaced = pathPart.replace(/\$\{[^}]*\}/g, ":param").replace(/\/+/g, "/");
  const trimmed = replaced.length > 1 ? replaced.replace(/\/$/, "") : replaced;
  return trimmed || "/";
}

function methodFromOptions(arg: ArgFact | undefined, fallback: string): string {
  const method = stringArg(objectProp(arg, "method"));
  return (method ?? fallback).toUpperCase();
}

export const fetchAdapter: FrameworkAdapter = {
  name: "fetch",
  classify({ value, call, workspace, file, symbol }) {
    const isFetch =
      (value.kind === "global" && value.name === "fetch" && value.member.length === 0) ||
      (value.kind === "global" &&
        (value.name === "window" || value.name === "globalThis" || value.name === "self") &&
        value.member.length === 1 &&
        value.member[0] === "fetch");
    const pkg = packageValue(value);
    const isPackagedFetch =
      pkg !== undefined &&
      isPackage(pkg, "node-fetch", "cross-fetch", "isomorphic-fetch", "undici", "ofetch") &&
      pkg.member.length === 0 &&
      (pkg.imported === "default" || pkg.imported === "fetch" || pkg.imported === "ofetch");
    if (!isFetch && !isPackagedFetch) return undefined;
    const url = urlFromArg(call.args[0], workspace, file, symbol) ?? {
      raw: call.text,
      unknownPrefix: true,
    };
    return {
      kind: "request",
      method: methodFromOptions(call.args[1], "GET"),
      url,
      client: "fetch",
    };
  },
};

function axiosBaseUrl(pkg: PackageValue): string | undefined {
  const create = pkg.ops.find((op) => op.op === "call" && op.member.at(-1) === "create");
  return create ? stringArg(objectProp(create.args[0], "baseURL")) : undefined;
}

export const axiosAdapter: FrameworkAdapter = {
  name: "axios",
  classify({ value, call, workspace, file, symbol }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "axios")) return undefined;
    const baseUrl = axiosBaseUrl(pkg);
    const isInstance = pkg.ops.length > 0;
    if (isInstance && !baseUrl && !pkg.ops.some((op) => op.member.at(-1) === "create"))
      return undefined;
    const method = pkg.member[pkg.member.length - 1];
    if (pkg.member.length === 0 || method === "request") {
      const config = call.args[0];
      const url = urlFromArg(objectProp(config, "url"), workspace, file, symbol, baseUrl);
      if (!url) return undefined;
      return { kind: "request", method: methodFromOptions(config, "GET"), url, client: "axios" };
    }
    if (pkg.member.length !== 1 || !method || !ALL_METHODS.has(method)) return undefined;
    const url = urlFromArg(call.args[0], workspace, file, symbol, baseUrl) ?? {
      raw: call.text,
      unknownPrefix: true,
    };
    return { kind: "request", method: method.toUpperCase(), url, client: "axios" };
  },
};

export const kyAdapter: FrameworkAdapter = {
  name: "ky",
  classify({ value, call, workspace, file, symbol }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "ky", "got")) return undefined;
    const method = pkg.member[pkg.member.length - 1] ?? "get";
    if (pkg.member.length > 1 || !ALL_METHODS.has(method)) return undefined;
    const prefix = pkg.ops
      .map((op) => stringArg(objectProp(op.args[0], "prefixUrl")))
      .find(Boolean);
    const url = urlFromArg(call.args[0], workspace, file, symbol, prefix) ?? {
      raw: call.text,
      unknownPrefix: true,
    };
    return { kind: "request", method: method.toUpperCase(), url, client: pkg.pkg };
  },
};

export const swrAdapter: FrameworkAdapter = {
  name: "swr",
  classify({ value, call, workspace, file, symbol }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "swr") || pkg.member.length > 0 || pkg.ops.length > 0)
      return undefined;
    const url = urlFromArg(call.args[0], workspace, file, symbol);
    return url?.path ? { kind: "request", method: "GET", url, client: "swr" } : undefined;
  },
};

export const httpAdapters: readonly FrameworkAdapter[] = [
  fetchAdapter,
  axiosAdapter,
  kyAdapter,
  swrAdapter,
];
