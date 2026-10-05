import type {
  ArgFact,
  BindingFact,
  FileFacts,
  ImportFact,
  InitSummary,
  MemberRef,
  PropertyFact,
  SymbolFact,
} from "../indexer/facts.js";
import type { LanguageAdapter, ModuleResolution, ModuleResolver } from "../lang/adapter.js";
import { adapterForFile, languageAdapters } from "../lang/registry.js";

/** One step in how a value was derived from a package export. */
export interface PackageOp {
  op: "new" | "call" | "type";
  /** Member path accessed on the value before the operation. */
  member: string[];
  args: ArgFact[];
  typeArgs?: string[];
}

/**
 * A value that originates in a third-party package, e.g. `prisma.user` is
 * `{ pkg: "@prisma/client", imported: "PrismaClient", ops: [new], member: ["user"] }`.
 */
export interface PackageValue {
  /** Module specifier without a `node:` prefix, e.g. "drizzle-orm/node-postgres". */
  pkg: string;
  imported: string;
  ops: PackageOp[];
  member: string[];
}

export type Value =
  | { kind: "symbol"; file: string; symbol: SymbolFact }
  | { kind: "object"; file: string; binding: BindingFact }
  | { kind: "instance"; file: string; cls: SymbolFact }
  | { kind: "namespace"; file: string }
  | { kind: "package"; value: PackageValue }
  | { kind: "global"; name: string; member: string[] }
  | { kind: "string"; value: string }
  | { kind: "unknown" };

const UNKNOWN: Value = { kind: "unknown" };
const MAX_DEPTH = 40;

/** Location of a named binding or symbol definition. */
export interface DefinitionRef {
  file: string;
  name: string;
  kind: "binding" | "symbol";
}

/**
 * Cross-file view over all {@link FileFacts}: resolves identifier paths to
 * symbols, object members, class instances or package-originated values.
 */
export class Workspace {
  readonly files = new Map<string, FileFacts>();
  private readonly symbolsById = new Map<string, SymbolFact>();
  private readonly topSymbols = new Map<string, Map<string, SymbolFact>>();
  private readonly nestedSymbols = new Map<string, Map<string, SymbolFact>>();
  private readonly memberSymbols = new Map<string, SymbolFact>();
  private readonly bindings = new Map<string, Map<string, BindingFact>>();
  private readonly importsByFile = new Map<string, Map<string, ImportFact>>();
  private readonly resolvers = new Map<string, ModuleResolver>();
  private readonly fileValueCache = new Map<string, Value>();
  private readonly inProgress = new Set<string>();
  private depth = 0;

  constructor(
    files: readonly FileFacts[],
    readonly root: string,
    private readonly adapters: readonly LanguageAdapter[] = languageAdapters,
  ) {
    const paths = new Set(files.map((file) => file.path));
    for (const adapter of adapters) {
      this.resolvers.set(adapter.id, adapter.createModuleResolver({ root, files: paths }));
    }
    for (const file of files) {
      this.files.set(file.path, file);
      const top = new Map<string, SymbolFact>();
      for (const symbol of file.symbols) {
        this.symbolsById.set(key(file.path, symbol.id), symbol);
        if (symbol.scope === "top" && !top.has(symbol.name)) top.set(symbol.name, symbol);
        if (symbol.scope === "member")
          this.memberSymbols.set(key(file.path, symbol.qualifiedName), symbol);
        if (symbol.scope === "nested" && symbol.parent) {
          const parentKey = key(file.path, symbol.parent);
          const nested = this.nestedSymbols.get(parentKey) ?? new Map<string, SymbolFact>();
          if (!nested.has(symbol.name)) nested.set(symbol.name, symbol);
          this.nestedSymbols.set(parentKey, nested);
        }
      }
      this.topSymbols.set(file.path, top);
      this.bindings.set(
        file.path,
        new Map(file.bindings.map((binding) => [binding.name, binding])),
      );
      this.importsByFile.set(file.path, new Map(file.imports.map((fact) => [fact.local, fact])));
    }
  }

  getSymbol(file: string, id: string): SymbolFact | undefined {
    return this.symbolsById.get(key(file, id));
  }

  getBinding(file: string, name: string): BindingFact | undefined {
    return this.bindings.get(file)?.get(name);
  }

  resolveModule(fromFile: string, specifier: string): ModuleResolution {
    const adapter = adapterForFile(fromFile, this.adapters);
    const resolver = adapter ? this.resolvers.get(adapter.id) : undefined;
    return resolver ? resolver.resolve(fromFile, specifier) : { kind: "unresolved" };
  }

  /** Resolves an identifier path (as written at a call site) to a value. */
  resolvePath(file: string, scope: SymbolFact | undefined, path: readonly string[]): Value {
    const head = path[0];
    if (head === undefined) return UNKNOWN;
    return this.guard(() => {
      let value: Value;
      if (head === "this") value = this.thisValue(file, scope);
      else if (head === "super") value = this.superValue(file, scope);
      else
        value =
          this.lookupScope(file, scope, head) ?? this.lookupFile(file, head) ?? globalValue(head);
      for (const name of path.slice(1)) {
        value = this.member(value, name);
        if (value.kind === "unknown") break;
      }
      return value;
    });
  }

  /** Resolves `name` as exported from `file`, following re-exports. */
  resolveExport(file: string, name: string): Value {
    return this.guard(() => {
      const facts = this.files.get(file);
      if (!facts) return UNKNOWN;
      for (const fact of facts.exports) {
        if (fact.kind === "local" && fact.exported === name)
          return this.resolveLocalName(file, fact.local);
        if (fact.kind === "reexport" && fact.exported === name) {
          return this.importTarget(file, fact.source, fact.imported);
        }
      }
      for (const fact of facts.exports) {
        if (fact.kind !== "reexport-all") continue;
        const resolution = this.resolveModule(file, fact.source);
        if (resolution.kind !== "file") continue;
        const value = this.resolveExport(resolution.path, name);
        if (value.kind !== "unknown") return value;
      }
      return UNKNOWN;
    });
  }

  /** Follows imports and exports to the binding or symbol a name refers to. */
  locateDefinition(file: string, name: string, depth = 0): DefinitionRef | undefined {
    if (depth > MAX_DEPTH) return undefined;
    if (this.bindings.get(file)?.has(name)) return { file, name, kind: "binding" };
    if (this.topSymbols.get(file)?.has(name)) return { file, name, kind: "symbol" };
    const imported = this.importsByFile.get(file)?.get(name);
    if (!imported) return undefined;
    const resolution = this.resolveModule(file, imported.source);
    if (resolution.kind !== "file") return undefined;
    return this.locateExport(resolution.path, imported.imported, depth + 1);
  }

  private locateExport(file: string, exported: string, depth: number): DefinitionRef | undefined {
    if (depth > MAX_DEPTH) return undefined;
    const facts = this.files.get(file);
    if (!facts) return undefined;
    for (const fact of facts.exports) {
      if (fact.kind === "local" && fact.exported === exported && !fact.local.includes(".")) {
        return this.locateDefinition(file, fact.local, depth + 1);
      }
      if (fact.kind === "reexport" && fact.exported === exported && fact.imported !== "*") {
        const resolution = this.resolveModule(file, fact.source);
        if (resolution.kind === "file")
          return this.locateExport(resolution.path, fact.imported, depth + 1);
      }
    }
    for (const fact of facts.exports) {
      if (fact.kind !== "reexport-all") continue;
      const resolution = this.resolveModule(file, fact.source);
      if (resolution.kind !== "file") continue;
      const found = this.locateExport(resolution.path, exported, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  /** Evaluates what a binding initializer produces. */
  evalInit(file: string, scope: SymbolFact | undefined, init: InitSummary): Value {
    return this.guard(() => {
      switch (init.kind) {
        case "new": {
          const callee = this.resolvePath(file, scope, init.callee);
          if (callee.kind === "symbol" && callee.symbol.kind === "class") {
            return { kind: "instance", file: callee.file, cls: callee.symbol };
          }
          if (callee.kind === "package") return applyOp(callee.value, "new", init.args);
          return UNKNOWN;
        }
        case "call": {
          const callee = this.resolvePath(file, scope, init.callee);
          if (callee.kind !== "package") return UNKNOWN;
          let value = applyOp(callee.value, "call", init.args);
          for (const segment of init.chain ?? []) {
            value = applyOp({ ...value.value, member: [segment.name] }, "call", segment.args);
          }
          return value;
        }
        case "alias":
          return this.resolvePath(file, scope, init.path);
        case "string":
          return { kind: "string", value: init.value };
        case "function": {
          const symbol = this.getSymbol(file, init.symbol);
          return symbol ? { kind: "symbol", file, symbol } : UNKNOWN;
        }
        case "object":
        case "other":
          return UNKNOWN;
      }
    });
  }

  /** Accesses `.name` on a value. */
  member(value: Value, name: string): Value {
    switch (value.kind) {
      case "symbol": {
        const symbol = value.symbol;
        if (symbol.kind === "class") {
          const staticMethod = this.memberSymbols.get(
            key(value.file, `${symbol.qualifiedName}.${name}`),
          );
          if (staticMethod) return { kind: "symbol", file: value.file, symbol: staticMethod };
          const base = this.heritageValue(value.file, symbol);
          return base ? this.member(base, name) : UNKNOWN;
        }
        return name === "call" || name === "apply" || name === "bind" ? value : UNKNOWN;
      }
      case "object": {
        const ref = value.binding.members?.[name];
        return ref ? this.memberRefValue(value.file, ref) : UNKNOWN;
      }
      case "instance": {
        const method = this.memberSymbols.get(
          key(value.file, `${value.cls.qualifiedName}.${name}`),
        );
        if (method) return { kind: "symbol", file: value.file, symbol: method };
        const property = value.cls.classInfo?.properties[name];
        if (property) return this.propertyValue(value.file, property);
        const base = this.heritageValue(value.file, value.cls);
        if (!base) return UNKNOWN;
        if (base.kind === "symbol" && base.symbol.kind === "class") {
          return this.member({ kind: "instance", file: base.file, cls: base.symbol }, name);
        }
        return this.member(base, name);
      }
      case "namespace":
        return this.resolveExport(value.file, name);
      case "package":
        return {
          kind: "package",
          value: { ...value.value, member: [...value.value.member, name] },
        };
      case "global":
        return { ...value, member: [...value.member, name] };
      case "string":
      case "unknown":
        return UNKNOWN;
    }
  }

  private guard(compute: () => Value): Value {
    if (this.depth > MAX_DEPTH) return UNKNOWN;
    this.depth++;
    try {
      return compute();
    } finally {
      this.depth--;
    }
  }

  private lookupScope(
    file: string,
    scope: SymbolFact | undefined,
    name: string,
  ): Value | undefined {
    let current = scope;
    while (current) {
      const nested = this.nestedSymbols.get(key(file, current.id))?.get(name);
      if (nested) return { kind: "symbol", file, symbol: nested };
      const local = current.locals[name];
      if (local) return this.evalInit(file, current, local);
      if (current.params.includes(name)) return UNKNOWN;
      current = current.parent ? this.getSymbol(file, current.parent) : undefined;
    }
    return undefined;
  }

  /** Top-level name in a file: symbol, binding or import. Memoized. */
  private lookupFile(file: string, name: string): Value | undefined {
    const cacheKey = key(file, name);
    const cached = this.fileValueCache.get(cacheKey);
    if (cached) return cached;
    if (this.inProgress.has(cacheKey)) return UNKNOWN;
    this.inProgress.add(cacheKey);
    try {
      const value = this.lookupFileUncached(file, name);
      if (value) this.fileValueCache.set(cacheKey, value);
      return value;
    } finally {
      this.inProgress.delete(cacheKey);
    }
  }

  private lookupFileUncached(file: string, name: string): Value | undefined {
    const symbol = this.topSymbols.get(file)?.get(name);
    if (symbol) return { kind: "symbol", file, symbol };
    const binding = this.bindings.get(file)?.get(name);
    if (binding) {
      if (binding.init.kind === "object") return { kind: "object", file, binding };
      return this.evalInit(file, undefined, binding.init);
    }
    const imported = this.importsByFile.get(file)?.get(name);
    if (imported) return this.importTarget(file, imported.source, imported.imported);
    return undefined;
  }

  private importTarget(file: string, source: string, imported: string): Value {
    const resolution = this.resolveModule(file, source);
    if (resolution.kind === "file") {
      return imported === "*"
        ? { kind: "namespace", file: resolution.path }
        : this.resolveExport(resolution.path, imported);
    }
    if (resolution.kind === "package") {
      const pkg = source.startsWith("node:") ? source.slice(5) : source;
      return { kind: "package", value: { pkg, imported, ops: [], member: [] } };
    }
    return UNKNOWN;
  }

  private resolveLocalName(file: string, local: string): Value {
    const [head, ...rest] = local.split(".");
    if (head === undefined) return UNKNOWN;
    let value = this.lookupFile(file, head) ?? UNKNOWN;
    for (const name of rest) value = this.member(value, name);
    return value;
  }

  private memberRefValue(file: string, ref: MemberRef): Value {
    switch (ref.kind) {
      case "symbol": {
        const symbol = this.getSymbol(file, ref.symbol);
        return symbol ? { kind: "symbol", file, symbol } : UNKNOWN;
      }
      case "path":
        return this.resolvePath(file, undefined, ref.path);
      case "value":
        return this.evalInit(file, undefined, ref.init);
    }
  }

  private propertyValue(file: string, property: PropertyFact): Value {
    if (property.init) {
      const value = this.evalInit(file, undefined, property.init);
      if (value.kind !== "unknown") return value;
    }
    if (!property.typeName) return UNKNOWN;
    const type = this.resolvePath(file, undefined, property.typeName.split("."));
    if (type.kind === "symbol" && type.symbol.kind === "class") {
      return { kind: "instance", file: type.file, cls: type.symbol };
    }
    if (type.kind === "package") {
      return {
        kind: "package",
        value: {
          ...type.value,
          ops: [
            ...type.value.ops,
            { op: "type", member: type.value.member, args: [], typeArgs: property.typeArgs ?? [] },
          ],
          member: [],
        },
      };
    }
    return UNKNOWN;
  }

  /** The value of a class's `extends` clause; package bases become instance-like values. */
  private heritageValue(file: string, cls: SymbolFact): Value | undefined {
    const base = cls.classInfo?.extends;
    if (!base) return undefined;
    const value = this.resolvePath(file, undefined, base);
    if (value.kind === "package") {
      return {
        kind: "package",
        value: {
          ...value.value,
          ops: [
            ...value.value.ops,
            { op: "type", member: value.value.member, args: [], typeArgs: [cls.name] },
          ],
          member: [],
        },
      };
    }
    return value.kind === "unknown" ? undefined : value;
  }

  private thisValue(file: string, scope: SymbolFact | undefined): Value {
    let current = scope;
    while (current) {
      if (current.scope === "member" && current.owner) {
        const owner = current.owner;
        const cls = this.topSymbols.get(file)?.get(owner);
        if (cls?.kind === "class") return { kind: "instance", file, cls };
        const binding =
          this.bindings.get(file)?.get(owner) ?? this.bindings.get(file)?.get("default");
        if (binding?.init.kind === "object") return { kind: "object", file, binding };
        return UNKNOWN;
      }
      current = current.parent ? this.getSymbol(file, current.parent) : undefined;
    }
    return UNKNOWN;
  }

  private superValue(file: string, scope: SymbolFact | undefined): Value {
    const instance = this.thisValue(file, scope);
    if (instance.kind !== "instance") return UNKNOWN;
    return this.heritageValue(file, instance.cls) ?? UNKNOWN;
  }
}

function key(file: string, name: string): string {
  return `${file}#${name}`;
}

function globalValue(name: string): Value {
  return { kind: "global", name, member: [] };
}

function applyOp(
  value: PackageValue,
  op: PackageOp["op"],
  args: ArgFact[],
): Extract<Value, { kind: "package" }> {
  return {
    kind: "package",
    value: { ...value, ops: [...value.ops, { op, member: value.member, args }], member: [] },
  };
}
