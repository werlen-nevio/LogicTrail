import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

/** Directories that never contain first-party source worth analyzing. */
export const DEFAULT_IGNORED_DIRECTORIES = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  "coverage",
  "storybook-static",
  ".logictrail",
];

export interface ScanOptions {
  /** Absolute repository root. */
  root: string;
  /** Extra gitignore-style patterns (from config), relative to the root. */
  ignore: readonly string[];
  /** Predicate deciding whether a file is source we can analyze. */
  accept: (relativePath: string) => boolean;
}

interface IgnoreScope {
  /** Repository-relative directory the rules are relative to ("" for root). */
  base: string;
  rules: Ignore;
}

/**
 * Lists analyzable files under `root`, honoring nested .gitignore files,
 * default ignored directories and configured ignore patterns. Returns
 * repository-relative paths with forward slashes, sorted.
 */
export async function scanRepository(options: ScanOptions): Promise<string[]> {
  const configRules = ignore().add([...options.ignore]);
  const results: string[] = [];
  const ignoredNames = new Set(DEFAULT_IGNORED_DIRECTORIES);

  const walk = async (relativeDir: string, scopes: IgnoreScope[]): Promise<void> => {
    const absoluteDir = path.join(options.root, relativeDir);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    const gitignore = entries.find((entry) => entry.isFile() && entry.name === ".gitignore");
    let currentScopes = scopes;
    if (gitignore) {
      try {
        const content = await fs.readFile(path.join(absoluteDir, ".gitignore"), "utf8");
        currentScopes = [...scopes, { base: relativeDir, rules: ignore().add(content) }];
      } catch {
        // Unreadable .gitignore: keep the parent rules.
      }
    }

    const subdirectories: string[] = [];
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ignoredNames.has(entry.name)) continue;
        if (isIgnored(`${relativePath}/`, currentScopes, configRules)) continue;
        subdirectories.push(relativePath);
      } else if (entry.isFile()) {
        if (!options.accept(relativePath)) continue;
        if (isIgnored(relativePath, currentScopes, configRules)) continue;
        results.push(relativePath);
      }
      // Symbolic links are skipped on purpose to avoid cycles and duplicates.
    }
    for (const subdirectory of subdirectories) await walk(subdirectory, currentScopes);
  };

  await walk("", []);
  return results.sort();
}

function isIgnored(relativePath: string, scopes: IgnoreScope[], configRules: Ignore): boolean {
  if (configRules.ignores(relativePath)) return true;
  for (const scope of scopes) {
    const local = scope.base ? relativePath.slice(scope.base.length + 1) : relativePath;
    if (local && scope.rules.ignores(local)) return true;
  }
  return false;
}
