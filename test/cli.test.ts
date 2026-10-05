import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { slugify } from "../src/output.js";
import { ACME_SHOP } from "./helpers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", path.join(projectRoot, "src/cli/main.ts"), ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
        LOGICTRAIL_MODEL: "",
        NO_COLOR: "1",
      },
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("cli", () => {
  it("prints Mermaid to stdout", () => {
    const result = cli([
      "how does login work?",
      "--root",
      ACME_SHOP,
      "--output",
      "mermaid",
      "--stdout",
      "--no-cache",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^%% LogicTrail: how does login work\?\nflowchart TD\n/);
    expect(result.stderr).toContain("No ANTHROPIC_API_KEY found");
    expect(result.stderr).toMatch(/✓ \d+ files/);
  });

  it("prints the prompt without an API key, sending and writing nothing", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "logictrail-prompt-"));
    try {
      const result = cli([
        "how does login work?",
        "--root",
        ACME_SHOP,
        "--out-dir",
        outDir,
        "--show-prompt",
        "--no-cache",
      ]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^# System prompt\n\nYou are the flow analyst/);
      expect(result.stdout).toContain("# User prompt\n\n<question>how does login work?</question>");
      expect(result.stderr).toContain("Nothing was sent.");
      expect(result.stderr).not.toContain("No ANTHROPIC_API_KEY found");
      expect(await fs.readdir(outDir)).toEqual([]);
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  });

  it("writes every requested format", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "logictrail-out-"));
    try {
      const result = cli([
        "--route",
        "POST /api/orders",
        "--root",
        ACME_SHOP,
        "--output",
        "all",
        "--out-dir",
        outDir,
        "--model",
        "static",
        "--no-cache",
      ]);
      expect(result.status).toBe(0);
      const files = (await fs.readdir(outDir)).sort();
      const name = "what-happens-when-post-api-orders-is-called";
      expect(files).toEqual([`${name}.html`, `${name}.json`, `${name}.mmd`, `${name}.svg`]);
      expect(result.stdout.trim().split("\n")).toHaveLength(4);
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  });

  it("explains usage errors", () => {
    const empty = cli(["--root", ACME_SHOP]);
    expect(empty.status).toBe(2);
    expect(empty.stderr).toContain("Ask a question or pick a starting point.");
    const badFormat = cli(["x", "--output", "pdf"]);
    expect(badFormat.status).not.toBe(0);
    expect(badFormat.stderr).toContain('Unknown format "pdf"');
    const unknown = cli([
      "--function",
      "doesNotExist",
      "--root",
      ACME_SHOP,
      "--model",
      "static",
      "--no-cache",
    ]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('No function named "doesNotExist" was found.');
  });

  it("updates saved flows", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "logictrail-update-"));
    try {
      const common = ["--root", ACME_SHOP, "--out-dir", outDir, "--model", "static", "--no-cache"];
      expect(cli(["--route", "POST /api/orders", "--output", "json,html", ...common]).status).toBe(
        0,
      );

      const updated = cli(["update", ...common]);
      expect(updated.status).toBe(0);
      expect(updated.stderr).toContain("what-happens-when-post-api-orders-is-called: no changes");
      expect(updated.stdout.trim().split("\n")).toHaveLength(2);

      const missing = cli(["update", "the", "cart", ...common]);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('No saved flow named "the"');
      expect(missing.stderr).toContain('quote it: logictrail "update …"');
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  });

  it("slugifies output names", () => {
    expect(slugify("How does checkout work?")).toBe("how-does-checkout-work");
    expect(slugify("Ünïcödé — flows!")).toBe("unicode-flows");
    expect(slugify("???")).toBe("flow");
  });
});
