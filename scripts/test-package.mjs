// Packs LogicTrail, installs the tarball into an empty project and runs the installed CLI on a copy
// of the sample app, the way `npx logictrail` runs after a release. Catches files missing from the
// package and paths that only break outside this repository.
// Run after `npm run build`: npm run test:package
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "logictrail-package-"));

try {
  const [packed] = JSON.parse(npm(["pack", "--json", "--pack-destination", work], root));
  fs.writeFileSync(path.join(work, "package.json"), '{ "name": "package-test", "private": true }');
  npm(["install", "--no-audit", "--no-fund", path.join(work, packed.filename)], work);

  const installed = path.join(work, "node_modules/logictrail");
  const { bin } = JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8"));
  const cli = path.join(installed, bin.logictrail);
  const run = (args) =>
    execFileSync(process.execPath, [cli, ...args], { cwd: work, encoding: "utf8" });

  const reported = run(["--version"]).trim();
  if (reported !== version) throw new Error(`--version printed ${reported}, expected ${version}.`);

  // Inside the scratch project, so the sample's logictrail.config.ts imports the installed package.
  const sample = path.join(work, "acme-shop");
  fs.cpSync(path.join(root, "examples/acme-shop"), sample, {
    recursive: true,
    filter: (source) => !/[\\/](\.logictrail|node_modules)$/.test(source),
  });
  run(["how does login work?", "--root", sample, "--model", "static", "--output", "html,json"]);
  run(["update", "--root", sample, "--model", "static"]);

  const outDir = path.join(sample, ".logictrail");
  const graph = JSON.parse(fs.readFileSync(path.join(outDir, "how-does-login-work.json"), "utf8"));
  if (graph.nodes.length === 0) throw new Error("The login flow has no steps.");
  const html = fs.readFileSync(path.join(outDir, "how-does-login-work.html"), "utf8");
  if (!html.includes('id="logictrail-data"')) throw new Error("The HTML viewer has no flow data.");
  console.log(
    `✓ ${packed.filename} installs and runs: ${graph.nodes.length} steps in the login flow.`,
  );
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

/** Runs npm without a shell where possible: Windows needs one to start npm.cmd directly. */
function npm(args, cwd) {
  const npmCli = process.env.npm_execpath;
  return npmCli && /npm-cli\.[cm]?js$/.test(npmCli)
    ? execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: "utf8" })
    : execFileSync("npm", args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}
