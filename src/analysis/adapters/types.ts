import type { ArgFact, CallFact, SymbolFact } from "../../indexer/facts.js";
import type { PackageValue, Value, Workspace } from "../workspace.js";

export interface CallSiteContext {
  file: string;
  symbol: SymbolFact;
  call: CallFact;
  /** What the callee path resolved to. */
  value: Value;
  workspace: Workspace;
}

export interface UrlSpec {
  /** URL as written, with `${...}` placeholders. */
  raw: string;
  /** Normalized path with `:param` placeholders, when the URL targets this app. */
  path?: string;
  /** Hostname for absolute URLs to other services. */
  host?: string;
  /** The URL starts with an unknown expression (e.g. `${API_URL}/orders`). */
  unknownPrefix: boolean;
}

export type Classification =
  | {
      kind: "database";
      system: string;
      model?: string;
      operation: string;
      access: "read" | "write";
    }
  | { kind: "external"; service: string; operation: string; package?: string }
  | { kind: "library"; package: string; operation: string; category: string; label: string }
  | { kind: "request"; method: string; url: UrlSpec; client: string }
  | {
      kind: "emit";
      channel: "event" | "queue";
      event: string;
      detail?: string;
      confidence: number;
      system: string;
    }
  | { kind: "navigate"; to: string; framework: string };

/**
 * A framework adapter recognizes calls into one library family (an ORM, an
 * HTTP client, an SDK, ...). Adapters are tried in order; the first match wins.
 */
export interface FrameworkAdapter {
  readonly name: string;
  classify(context: CallSiteContext): Classification | undefined;
}

export function packageValue(value: Value): PackageValue | undefined {
  return value.kind === "package" ? value.value : undefined;
}

export function isPackage(value: PackageValue, ...names: string[]): boolean {
  return names.some((name) => value.pkg === name || value.pkg.startsWith(`${name}/`));
}

/** True if the value is an instance/client produced by `new X()` or a factory call. */
export function isConstructed(value: PackageValue): boolean {
  return value.ops.length > 0;
}

export function stringArg(arg: ArgFact | undefined): string | undefined {
  if (!arg) return undefined;
  if (arg.kind === "string") return arg.value;
  return undefined;
}

export function stringOrTemplateArg(arg: ArgFact | undefined): string | undefined {
  if (!arg) return undefined;
  if (arg.kind === "string" || arg.kind === "template") return arg.value;
  return undefined;
}

export function identifierArg(arg: ArgFact | undefined): string | undefined {
  if (arg?.kind !== "path") return undefined;
  return arg.path[arg.path.length - 1];
}

export function objectProp(arg: ArgFact | undefined, name: string): ArgFact | undefined {
  return arg?.kind === "object" ? arg.props[name] : undefined;
}
