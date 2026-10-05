/**
 * Language-neutral facts extracted from a single source file.
 *
 * Facts are a pure function of (file path, file content), which is what makes
 * them cacheable by content hash. Everything that needs knowledge of other
 * files (import resolution, call targets, route prefixes) happens later in
 * the analysis layer.
 *
 * Bump FACTS_VERSION whenever the shape or the extraction semantics change so
 * stale caches are discarded.
 */

export const FACTS_VERSION = 3;

export interface FileFacts {
  /** Repository-relative path with forward slashes. */
  path: string;
  language: string;
  hash: string;
  lineCount: number;
  imports: ImportFact[];
  exports: ExportFact[];
  symbols: SymbolFact[];
  /** Top-level, non-function variable bindings (`const db = new PrismaClient()`). */
  bindings: BindingFact[];
  routes: RouteFact[];
  mounts: MountFact[];
  listeners: ListenerFact[];
  pages: PageFact[];
  /** File-level directives such as "use client" / "use server". */
  directives: string[];
  /** Number of syntax errors reported by the parser (facts may be partial). */
  parseErrors: number;
}

export interface ImportFact {
  source: string;
  /** Local binding name. */
  local: string;
  /** "default", "*" for namespace imports, or the imported export name. */
  imported: string;
  line: number;
  typeOnly: boolean;
  kind: "import" | "require" | "dynamic";
}

export type ExportFact =
  | { kind: "local"; exported: string; local: string; line: number }
  | { kind: "reexport"; exported: string; imported: string; source: string; line: number }
  | { kind: "reexport-all"; source: string; line: number };

export type SymbolKind = "function" | "method" | "component" | "class" | "handler";

export interface SymbolFact {
  /** Unique within the file. Equal to `qualifiedName` unless disambiguated. */
  id: string;
  name: string;
  /** Dotted path of enclosing classes / functions / objects, e.g. "AuthService.login". */
  qualifiedName: string;
  kind: SymbolKind;
  line: number;
  endLine: number;
  /** id of the enclosing symbol (class, function or object binding). */
  parent?: string;
  /** For methods: the owning class or object binding name. */
  owner?: string;
  /** How the parent relates: a nested function vs. a member of a class/object. */
  scope: "top" | "nested" | "member";
  async: boolean;
  params: string[];
  doc?: string;
  /** First line of the declaration, trimmed. */
  signature: string;
  returnsJsx: boolean;
  steps: Step[];
  envVars: string[];
  /** Notable string literals used in the body (for retrieval). */
  literals: string[];
  /** Function-local bindings whose initializer matters for resolution. */
  locals: Record<string, InitSummary>;
  /** For classes. */
  classInfo?: ClassInfo;
}

export interface ClassInfo {
  extends?: string[];
  properties: Record<string, PropertyFact>;
}

export interface PropertyFact {
  typeName?: string;
  typeArgs?: string[];
  init?: InitSummary;
}

export interface BindingFact {
  name: string;
  line: number;
  init: InitSummary;
  /** For object literal initializers: member name -> what it refers to. */
  members?: Record<string, MemberRef>;
  /** For string constants, the literal value (used to resolve URLs). */
  stringValue?: string;
}

export type MemberRef =
  | { kind: "symbol"; symbol: string }
  | { kind: "path"; path: string[] }
  | { kind: "value"; init: InitSummary };

export type InitSummary =
  | { kind: "new"; callee: string[]; args: ArgFact[] }
  | { kind: "call"; callee: string[]; args: ArgFact[]; chain?: ChainSegment[] }
  | { kind: "object" }
  | { kind: "alias"; path: string[] }
  | { kind: "string"; value: string }
  | { kind: "function"; symbol: string }
  | { kind: "other" };

export type ArgFact =
  | { kind: "string"; value: string }
  | { kind: "template"; value: string }
  | { kind: "number"; value: number }
  | { kind: "path"; path: string[] }
  | { kind: "object"; props: Record<string, ArgFact> }
  | { kind: "call"; path: string[]; args: ArgFact[] }
  | { kind: "function" }
  | { kind: "other"; text: string };

export interface ChainSegment {
  name: string;
  args: ArgFact[];
}

export interface CallFact {
  /** Callee path, e.g. ["prisma", "user", "findUnique"]; may start with "this". */
  path: string[];
  /** Fluent continuation, e.g. db.select().from(users) -> [{ name: "from", ... }]. */
  chain: ChainSegment[];
  line: number;
  column: number;
  /** Source text of the call, single line, truncated. */
  text: string;
  args: ArgFact[];
  awaited: boolean;
  /** Call sits inside a loop body. */
  inLoop: boolean;
  /** Set when the call happens inside an inline JSX handler or effect, e.g. "onSubmit". */
  via?: string;
}

export interface RefFact {
  path: string[];
  line: number;
  column: number;
  context: "jsx-element" | "jsx-attribute" | "argument" | "property";
  /** JSX attribute or object property name, e.g. "onSubmit" / "mutationFn". */
  name?: string;
  /** For argument refs, the callee receiving the reference. */
  callee?: string;
  text: string;
}

export interface ExitFact {
  kind: "throw" | "response" | "redirect";
  line: number;
  status?: number;
  text: string;
  errorName?: string;
  message?: string;
  target?: string;
}

export type Step =
  | { kind: "call"; call: CallFact }
  | { kind: "ref"; ref: RefFact }
  | { kind: "exit"; exit: ExitFact }
  | { kind: "branch"; line: number; test: string; arms: BranchArm[] }
  | { kind: "catch"; line: number; param?: string; steps: Step[] };

export interface BranchArm {
  /** "then", "else", or a switch label such as "case 'paid'" / "default". */
  label: string;
  steps: Step[];
  /** The arm ends the enclosing function (return/throw at its top level). */
  terminates: boolean;
}

export type HandlerRef =
  | { kind: "symbol"; symbol: string }
  | { kind: "path"; path: string[] }
  | { kind: "call"; path: string[]; text: string };

export interface RouteFact {
  method: string;
  path: string;
  framework: "express" | "next-app" | "next-pages" | "generic";
  /** Path of the router object the route is registered on (Express-style). */
  router?: string[];
  /** Middleware first, the final handler last. */
  handlers: HandlerRef[];
  line: number;
  text: string;
}

export interface MountFact {
  router: string[];
  prefix: string;
  targets: HandlerRef[];
  line: number;
}

export interface ListenerFact {
  emitter: string[];
  event: string;
  channel: "event" | "queue";
  handler: HandlerRef;
  line: number;
  text: string;
}

export interface PageFact {
  path: string;
  /** Component symbol id in this file, or a reference to resolve. */
  component: HandlerRef;
  framework: "next-app" | "next-pages" | "react-router";
  line: number;
}
