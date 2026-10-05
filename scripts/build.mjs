// Builds the package: compiles the Node code with tsc and bundles the browser viewer.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });

const tsc = spawnSync(
  process.execPath,
  [path.join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const viewerOut = path.join(dist, "viewer");
fs.mkdirSync(viewerOut, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, "src/viewer/main.ts")],
  outfile: path.join(viewerOut, "viewer.js"),
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
});
fs.copyFileSync(path.join(root, "src/viewer/viewer.css"), path.join(viewerOut, "viewer.css"));

const cli = path.join(dist, "cli/main.js");
if (process.platform !== "win32") fs.chmodSync(cli, 0o755);
console.log("Built dist/ (library, CLI and viewer).");
