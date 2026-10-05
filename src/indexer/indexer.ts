import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { LanguageAdapter } from "../lang/adapter.js";
import { adapterForFile, languageAdapters } from "../lang/registry.js";
import { silentReporter, type Reporter } from "../reporter.js";
import { FactsCache } from "./cache.js";
import { FACTS_VERSION, type FileFacts } from "./facts.js";
import { scanRepository } from "./scan.js";

export interface IndexOptions {
  /** Absolute repository root. */
  root: string;
  ignore?: readonly string[];
  /** Directory for the facts cache; `false` disables caching. */
  cacheDir?: string | false;
  adapters?: readonly LanguageAdapter[];
  /** Files larger than this are skipped (likely generated or bundled). */
  maxFileBytes?: number;
  reporter?: Reporter;
}

export interface IndexResult {
  root: string;
  files: FileFacts[];
  stats: {
    files: number;
    parsed: number;
    cached: number;
    skipped: number;
    symbols: number;
    parseErrors: number;
    durationMs: number;
  };
  warnings: string[];
}

const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const READ_CONCURRENCY = 16;

export async function indexRepository(options: IndexOptions): Promise<IndexResult> {
  const started = performance.now();
  const reporter = options.reporter ?? silentReporter;
  const adapters = options.adapters ?? languageAdapters;
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const warnings: string[] = [];

  const paths = await scanRepository({
    root: options.root,
    ignore: options.ignore ?? [],
    accept: (file) => adapterForFile(file, adapters) !== undefined,
  });

  const version = [
    `facts:${FACTS_VERSION}`,
    ...adapters.map((adapter) => `${adapter.id}:${adapter.version}`),
  ].join("|");
  const cache =
    options.cacheDir === false || options.cacheDir === undefined
      ? FactsCache.disabled()
      : await FactsCache.load(options.cacheDir, version);

  const files: FileFacts[] = new Array<FileFacts>(paths.length);
  let parsed = 0;
  let cached = 0;
  let skipped = 0;
  let done = 0;

  const processFile = async (index: number): Promise<void> => {
    const relativePath = paths[index];
    if (relativePath === undefined) return;
    const adapter = adapterForFile(relativePath, adapters);
    if (!adapter) return;
    const absolutePath = path.join(options.root, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.size > maxBytes) {
        skipped++;
        warnings.push(
          `Skipped ${relativePath} (${Math.round(stat.size / 1024)} KB exceeds size limit)`,
        );
        return;
      }
      const content = await fs.readFile(absolutePath, "utf8");
      const hash = createHash("sha1").update(content).digest("hex");
      const hit = cache.get(relativePath, hash);
      if (hit) {
        files[index] = hit;
        cached++;
      } else {
        const facts = adapter.extract({ path: relativePath, content, hash });
        cache.set(facts);
        files[index] = facts;
        parsed++;
      }
    } catch (error) {
      skipped++;
      warnings.push(`Could not analyze ${relativePath}: ${(error as Error).message}`);
    } finally {
      done++;
      reporter.progress("Indexing", done, paths.length);
    }
  };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(READ_CONCURRENCY, paths.length) }, async () => {
    while (cursor < paths.length) {
      const index = cursor++;
      await processFile(index);
    }
  });
  await Promise.all(workers);

  try {
    await cache.save();
  } catch (error) {
    warnings.push(`Could not write cache: ${(error as Error).message}`);
  }

  const indexed = files.filter((file): file is FileFacts => file !== undefined);
  return {
    root: options.root,
    files: indexed,
    stats: {
      files: indexed.length,
      parsed,
      cached,
      skipped,
      symbols: indexed.reduce((sum, file) => sum + file.symbols.length, 0),
      parseErrors: indexed.reduce((sum, file) => sum + (file.parseErrors > 0 ? 1 : 0), 0),
      durationMs: Math.round(performance.now() - started),
    },
    warnings,
  };
}
