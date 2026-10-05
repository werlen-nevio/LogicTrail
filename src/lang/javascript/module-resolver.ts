import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { ModuleResolution, ModuleResolver, ModuleResolverContext } from "../adapter.js";

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

interface PathMapping {
  /** Repository-relative directory that `paths` targets are relative to. */
  baseDir: string;
  /** True when `baseUrl` is set, enabling bare `src/lib/x` style imports. */
  hasBaseUrl: boolean;
  patterns: { prefix: string; suffix: string; wildcard: boolean; targets: string[] }[];
}

/**
 * Resolves JavaScript/TypeScript module specifiers to repository files.
 *
 * Supports relative imports, extension probing, ESM `.js` -> `.ts` mapping,
 * directory indexes, and `paths`/`baseUrl` from the nearest tsconfig.json or
 * jsconfig.json (including `extends`). Everything else is treated as a package.
 */
export class JavaScriptModuleResolver implements ModuleResolver {
  private readonly mappings = new Map<string, PathMapping | null>();
  private readonly cache = new Map<string, ModuleResolution>();

  constructor(private readonly context: ModuleResolverContext) {}

  resolve(fromFile: string, specifier: string): ModuleResolution {
    const key = `${fromFile}\0${specifier}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = this.resolveUncached(fromFile, specifier);
    this.cache.set(key, result);
    return result;
  }

  private resolveUncached(fromFile: string, specifier: string): ModuleResolution {
    if (specifier.startsWith(".")) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
      const file = this.probe(base);
      return file ? { kind: "file", path: file } : { kind: "unresolved" };
    }
    if (specifier.startsWith("/")) return { kind: "unresolved" };

    const mapping = this.mappingFor(path.posix.dirname(fromFile));
    if (mapping) {
      for (const pattern of mapping.patterns) {
        const matched = matchPattern(pattern, specifier);
        if (matched === undefined) continue;
        for (const target of pattern.targets) {
          const substituted = pattern.wildcard ? target.replace("*", matched) : target;
          const file = this.probe(
            path.posix.normalize(path.posix.join(mapping.baseDir, substituted)),
          );
          if (file) return { kind: "file", path: file };
        }
      }
      if (mapping.hasBaseUrl) {
        const file = this.probe(path.posix.normalize(path.posix.join(mapping.baseDir, specifier)));
        if (file) return { kind: "file", path: file };
      }
    }

    const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
    const parts = bare.split("/");
    const nameLength = bare.startsWith("@") ? 2 : 1;
    return {
      kind: "package",
      name: parts.slice(0, nameLength).join("/"),
      subpath: parts.slice(nameLength).join("/"),
    };
  }

  private probe(base: string): string | undefined {
    const { files } = this.context;
    const cleaned = base.startsWith("./") ? base.slice(2) : base;
    if (files.has(cleaned)) return cleaned;
    const extension = path.posix.extname(cleaned);
    const alternatives = JS_TO_TS[extension];
    if (alternatives) {
      const stem = cleaned.slice(0, -extension.length);
      for (const alternative of alternatives) {
        if (files.has(stem + alternative)) return stem + alternative;
      }
    }
    for (const candidate of EXTENSIONS) {
      if (files.has(cleaned + candidate)) return cleaned + candidate;
    }
    for (const candidate of EXTENSIONS) {
      const index = `${cleaned}/index${candidate}`;
      if (files.has(index)) return index;
    }
    return undefined;
  }

  private mappingFor(directory: string): PathMapping | null {
    const cached = this.mappings.get(directory);
    if (cached !== undefined) return cached;
    let result: PathMapping | null = null;
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const configPath = path.join(this.context.root, directory, name);
      if (fs.existsSync(configPath)) {
        result = this.readMapping(configPath, directory);
        break;
      }
    }
    if (result === null && directory !== "." && directory !== "") {
      const parent = path.posix.dirname(directory);
      result = this.mappingFor(parent === directory ? "." : parent);
    }
    this.mappings.set(directory, result);
    return result;
  }

  private readMapping(configPath: string, directory: string): PathMapping | null {
    const read = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
    if (read.error || !read.config) return null;
    // A host that never enumerates files: we only need compilerOptions.
    const host: ts.ParseConfigHost = {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      readDirectory: () => [],
      fileExists: (file) => ts.sys.fileExists(file),
      readFile: (file) => ts.sys.readFile(file),
    };
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      host,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    const options = parsed.options;
    const pathsBase =
      options.baseUrl ??
      (options as { pathsBasePath?: string }).pathsBasePath ??
      path.dirname(configPath);
    const baseDir = toRepoPath(this.context.root, pathsBase) ?? directory;
    const patterns: PathMapping["patterns"] = [];
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      const star = pattern.indexOf("*");
      patterns.push({
        prefix: star === -1 ? pattern : pattern.slice(0, star),
        suffix: star === -1 ? "" : pattern.slice(star + 1),
        wildcard: star !== -1,
        targets,
      });
    }
    patterns.sort((a, b) => b.prefix.length - a.prefix.length);
    if (patterns.length === 0 && options.baseUrl === undefined) return null;
    return { baseDir, hasBaseUrl: options.baseUrl !== undefined, patterns };
  }
}

function matchPattern(
  pattern: PathMapping["patterns"][number],
  specifier: string,
): string | undefined {
  if (!pattern.wildcard) return specifier === pattern.prefix ? "" : undefined;
  if (!specifier.startsWith(pattern.prefix) || !specifier.endsWith(pattern.suffix))
    return undefined;
  return specifier.slice(pattern.prefix.length, specifier.length - pattern.suffix.length);
}

function toRepoPath(root: string, absolute: string): string | undefined {
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  const posix = relative.split(path.sep).join("/");
  return posix === "" ? "." : posix;
}
