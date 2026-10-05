import fs from "node:fs/promises";
import path from "node:path";
import type { FileFacts } from "./facts.js";

interface CacheContent {
  version: string;
  files: Record<string, FileFacts>;
}

const CACHE_FILE = "facts.json";

/**
 * Per-file facts cache keyed by repository path and content hash.
 * A version mismatch (facts schema, adapter versions) discards everything.
 */
export class FactsCache {
  private readonly next: Record<string, FileFacts> = {};
  private dirty = false;

  private constructor(
    private readonly directory: string | undefined,
    private readonly version: string,
    private readonly previous: Record<string, FileFacts>,
  ) {}

  static disabled(): FactsCache {
    return new FactsCache(undefined, "", {});
  }

  static async load(directory: string, version: string): Promise<FactsCache> {
    try {
      const raw = await fs.readFile(path.join(directory, CACHE_FILE), "utf8");
      const content = JSON.parse(raw) as Partial<CacheContent>;
      if (content.version === version && content.files && typeof content.files === "object") {
        return new FactsCache(directory, version, content.files);
      }
    } catch {
      // Missing or corrupt cache: start fresh.
    }
    return new FactsCache(directory, version, {});
  }

  get(filePath: string, hash: string): FileFacts | undefined {
    const cached = this.previous[filePath];
    if (cached?.hash !== hash) return undefined;
    this.next[filePath] = cached;
    return cached;
  }

  set(facts: FileFacts): void {
    this.next[facts.path] = facts;
    this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.directory) return;
    const removed = Object.keys(this.previous).some((key) => !(key in this.next));
    if (!this.dirty && !removed) return;
    await fs.mkdir(this.directory, { recursive: true });
    // Keep caches out of version control without touching the user's .gitignore.
    await fs.writeFile(path.join(this.directory, ".gitignore"), "*\n");
    const content: CacheContent = { version: this.version, files: this.next };
    const target = path.join(this.directory, CACHE_FILE);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(content));
    await fs.rename(temporary, target);
  }
}
