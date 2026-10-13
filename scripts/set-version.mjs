// Writes a release version into package.json, package-lock.json and the Claude plugin, so the git
// tag is the only place a version is chosen. Accepts "1.2.3" or a tag such as "v1.2.3".
// --if-newer leaves the files alone unless the version is newer than package.json's.
// Usage: node scripts/set-version.mjs <version|tag> [--if-newer]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values, positionals } = parseArgs({
  options: { "if-newer": { type: "boolean" } },
  allowPositionals: true,
});

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const version = positionals[0]?.replace(/^v/, "");
if (positionals.length !== 1 || !SEMVER.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <version|tag> [--if-newer], e.g. v1.2.3");
  process.exit(1);
}

const file = (name) => path.join(root, name);
const readJson = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));
const writeJson = (name, data) =>
  fs.writeFileSync(file(name), `${JSON.stringify(data, null, 2)}\n`);

const current = readJson("package.json").version;
if (values["if-newer"] && compare(version, current) <= 0) {
  console.log(`package.json is at ${current}, which is not older than ${version}. Nothing to do.`);
  process.exit(0);
}

const pkg = readJson("package.json");
pkg.version = version;
writeJson("package.json", pkg);

const lock = readJson("package-lock.json");
lock.version = version;
lock.packages[""].version = version;
writeJson("package-lock.json", lock);

const pluginFile = "claude-plugin/.claude-plugin/plugin.json";
const plugin = readJson(pluginFile);
plugin.version = version;
writeJson(pluginFile, plugin);

console.log(`Set ${version} in package.json, package-lock.json and the Claude plugin.`);

/** Semver precedence: negative when a < b, 0 when equal, positive when a > b. */
function compare(a, b) {
  const [, ...pa] = SEMVER.exec(a) ?? [];
  const [, ...pb] = SEMVER.exec(b) ?? [];
  for (let i = 0; i < 3; i++) {
    if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) - Number(pb[i]);
  }
  // A prerelease sorts before its release; prerelease identifiers compare left to right.
  if (pa[3] === pb[3]) return 0;
  if (pa[3] === undefined) return 1;
  if (pb[3] === undefined) return -1;
  const ia = pa[3].split(".");
  const ib = pb[3].split(".");
  for (let i = 0; i < Math.min(ia.length, ib.length); i++) {
    if (ia[i] === ib[i]) continue;
    const na = /^\d+$/.test(ia[i]);
    const nb = /^\d+$/.test(ib[i]);
    if (na && nb) return Number(ia[i]) - Number(ib[i]);
    if (na !== nb) return na ? -1 : 1;
    return ia[i] < ib[i] ? -1 : 1;
  }
  return ia.length - ib.length;
}
