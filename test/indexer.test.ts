import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/load.js";
import { indexRepository } from "../src/indexer/indexer.js";
import { scanRepository } from "../src/indexer/scan.js";

let root: string;

async function write(file: string, content: string): Promise<void> {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "logictrail-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("scanning", () => {
  it("respects .gitignore files, default ignores and configured patterns", async () => {
    await write(".gitignore", "generated/\n*.secret.ts\n");
    await write("src/app.ts", "export const a = 1;");
    await write("src/keys.secret.ts", "export const k = 1;");
    await write("src/legacy/.gitignore", "old.js\n");
    await write("src/legacy/old.js", "module.exports = {};");
    await write("src/legacy/new.js", "module.exports = {};");
    await write("generated/client.ts", "export {};");
    await write("node_modules/lib/index.js", "module.exports = {};");
    await write("dist/app.js", "");
    await write("tests/app.test.ts", "");
    await write("src/types.d.ts", "");
    await write("README.md", "");

    const files = await scanRepository({
      root,
      ignore: ["tests/**"],
      accept: (file) => /\.(ts|js)$/.test(file) && !file.endsWith(".d.ts"),
    });
    expect(files).toEqual(["src/app.ts", "src/legacy/new.js"]);
  });
});

describe("indexing and caching", () => {
  it("reuses cached facts for unchanged files", async () => {
    await write("src/a.ts", "export function a() { return b(); }\nfunction b() {}");
    await write("src/b.ts", "export const value = 1;");
    const cacheDir = path.join(root, ".logictrail/cache");

    const first = await indexRepository({ root, cacheDir });
    expect(first.stats).toMatchObject({ files: 2, parsed: 2, cached: 0, symbols: 2 });
    expect(await fs.readFile(path.join(cacheDir, ".gitignore"), "utf8")).toBe("*\n");

    const second = await indexRepository({ root, cacheDir });
    expect(second.stats).toMatchObject({ files: 2, parsed: 0, cached: 2 });
    expect(second.files).toEqual(first.files);

    await write("src/b.ts", "export const value = 2;\nexport function changed() {}");
    const third = await indexRepository({ root, cacheDir });
    expect(third.stats).toMatchObject({ parsed: 1, cached: 1, symbols: 3 });
  });

  it("skips oversized files with a warning", async () => {
    await write("src/small.ts", "export const a = 1;");
    await write("src/bundle.js", `var x = "${"a".repeat(2000)}";`);
    const result = await indexRepository({ root, cacheDir: false, maxFileBytes: 1000 });
    expect(result.files.map((file) => file.path)).toEqual(["src/small.ts"]);
    expect(result.warnings[0]).toMatch(/Skipped src\/bundle\.js/);
  });
});

describe("configuration", () => {
  it("loads logictrail.config.ts", async () => {
    await write(
      "logictrail.config.ts",
      `const config: { ignore: string[]; maxDepth: number; outputDir: string } = {
  ignore: ["tests/**", "generated/**"],
  maxDepth: 10,
  outputDir: ".logictrail",
};
export default config;
`,
    );
    const config = await loadConfig(root);
    expect(config).toMatchObject({
      ignore: ["tests/**", "generated/**"],
      maxDepth: 10,
      outputDir: ".logictrail",
      maxNodes: 60,
    });
    expect(config.configFile).toBe(path.join(root, "logictrail.config.ts"));
  });

  it("uses defaults without a config file and rejects invalid configs", async () => {
    expect((await loadConfig(root)).llm.model).toBe("auto");
    await write("logictrail.config.json", JSON.stringify({ maxDepth: 0, outptuDir: "x" }));
    await expect(loadConfig(root)).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig(root)).rejects.toThrow(/maxDepth[\s\S]*Unrecognized key/);
  });
});
