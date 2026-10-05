import type { FileFacts } from "../indexer/facts.js";

/**
 * A language adapter turns source files of one language family into
 * language-neutral {@link FileFacts} and knows how that language resolves
 * module specifiers. Adding Python, Go, etc. means adding another adapter;
 * nothing downstream of the facts depends on a specific language.
 */
export interface LanguageAdapter {
  readonly id: string;
  /** Lower-case file extensions including the dot, e.g. ".ts". */
  readonly extensions: readonly string[];
  /** Bumped when extraction output changes; part of the cache key. */
  readonly version: number;
  extract(input: { path: string; content: string; hash: string }): FileFacts;
  createModuleResolver(context: ModuleResolverContext): ModuleResolver;
}

export interface ModuleResolverContext {
  /** Absolute repository root. */
  root: string;
  /** All indexed files, repository-relative with forward slashes. */
  files: ReadonlySet<string>;
}

export type ModuleResolution =
  | { kind: "file"; path: string }
  | { kind: "package"; name: string; subpath: string }
  | { kind: "unresolved" };

export interface ModuleResolver {
  resolve(fromFile: string, specifier: string): ModuleResolution;
}
