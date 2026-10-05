import fs from "node:fs";
import path from "node:path";
import type { SourceSnippet } from "./graph/model.js";

/** Reads repository files on demand (for prompts and embedded snippets), with caching. */
export class SourceReader {
  private readonly cache = new Map<string, string[] | null>();

  constructor(private readonly root: string) {}

  lines(file: string): string[] | undefined {
    if (!this.cache.has(file)) {
      try {
        const content = fs.readFileSync(path.join(this.root, file), "utf8");
        this.cache.set(file, content.split(/\r?\n/));
      } catch {
        this.cache.set(file, null);
      }
    }
    return this.cache.get(file) ?? undefined;
  }

  line(file: string, line: number): string | undefined {
    return this.lines(file)?.[line - 1]?.trim();
  }

  /** Lines `start..end` (1-based, inclusive), capped at `maxLines`. */
  snippet(file: string, start: number, end: number, maxLines = 60): SourceSnippet | undefined {
    const lines = this.lines(file);
    if (!lines) return undefined;
    const first = Math.max(1, start);
    const last = Math.min(lines.length, end, first + maxLines - 1);
    if (last < first) return undefined;
    return {
      startLine: first,
      lines: lines.slice(first - 1, last),
      truncated: last < Math.min(lines.length, end),
    };
  }
}
