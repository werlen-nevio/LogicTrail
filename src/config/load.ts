import fs from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import { ConfigSchema, resolveConfig, type ResolvedConfig } from "./config.js";

export const CONFIG_FILE_NAMES = [
  "logictrail.config.ts",
  "logictrail.config.mts",
  "logictrail.config.js",
  "logictrail.config.mjs",
  "logictrail.config.cjs",
  "logictrail.config.json",
];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Loads `logictrail.config.*` from the repository root (or an explicit path).
 * TypeScript configs are evaluated with jiti, so no build step is needed.
 */
export async function loadConfig(root: string, explicitPath?: string): Promise<ResolvedConfig> {
  const file = explicitPath ? path.resolve(root, explicitPath) : await findConfigFile(root);
  if (!file) return resolveConfig({});

  let raw: unknown;
  try {
    if (file.endsWith(".json")) {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } else {
      const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
      raw = await jiti.import(file, { default: true });
    }
  } catch (error) {
    throw new ConfigError(
      `Could not load ${path.relative(root, file) || file}: ${(error as Error).message}`,
    );
  }

  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(
        (issue) =>
          `  - ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new ConfigError(
      `Invalid configuration in ${path.relative(root, file) || file}:\n${issues}`,
    );
  }
  return resolveConfig(parsed.data, file);
}

async function findConfigFile(root: string): Promise<string | undefined> {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(root, name);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Not present; try the next name.
    }
  }
  return undefined;
}
