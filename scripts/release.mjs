// Checks that a release is consistent: package.json and the Claude plugin share one version,
// CHANGELOG.md has a dated entry for it, the plugin's bin/ scripts are executable and, with --tag,
// the tag names that version. --notes writes the changelog entry to a file for the GitHub Release.
// Usage: node scripts/release.mjs [--tag v1.2.3] [--notes <file>]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { tag: { type: "string" }, notes: { type: "string" } } });

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const { version } = readJson("package.json");
const plugin = readJson("claude-plugin/.claude-plugin/plugin.json");
const problems = [];

if (plugin.version !== version) {
  problems.push(`The Claude plugin is at ${plugin.version} but package.json is at ${version}.`);
}
if (values.tag !== undefined && values.tag !== `v${version}`) {
  problems.push(`Tag ${values.tag} does not match package.json (expected v${version}).`);
}

const notes = changelogEntry(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version);
if (notes === undefined) {
  problems.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" entry.`);
} else if (!notes) {
  problems.push(`The CHANGELOG.md entry for ${version} is empty.`);
}

// Claude Code runs the plugin's bin/ scripts directly, so they need the executable bit. Windows
// checkouts cannot show it, so read it from the git index.
const staged = execFileSync("git", ["ls-files", "--stage", "claude-plugin/bin"], {
  cwd: root,
  encoding: "utf8",
});
for (const line of staged.split("\n").filter(Boolean)) {
  const [meta = "", file] = line.split("\t");
  if (!meta.startsWith("100755")) {
    problems.push(`${file} is not executable. Run: git add --chmod=+x ${file}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
if (values.notes) fs.writeFileSync(values.notes, `${unwrap(notes)}\n`);
console.log(`✓ ${version}: package.json, the Claude plugin and CHANGELOG.md agree.`);

/** The body of a version's dated changelog entry, or undefined when there is none. */
function changelogEntry(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  // The entry ends at the next version heading or at the link definitions at the bottom.
  const end = rest.findIndex((line) => line.startsWith("## ") || /^\[[^\]]+\]:\s/.test(line));
  return rest
    .slice(0, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

/** Joins hard-wrapped lines, which GitHub would render as line breaks in a release's notes. */
function unwrap(markdown) {
  const lines = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    const previous = lines.at(-1);
    const continues =
      !fenced &&
      previous?.trim() &&
      !previous.startsWith("#") &&
      line.trim() &&
      !/^\s*([-*+]|\d+\.)\s|^#|^\s*```/.test(line);
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (continues) lines[lines.length - 1] = `${previous} ${line.trim()}`;
    else lines.push(line);
  }
  return lines.join("\n");
}
