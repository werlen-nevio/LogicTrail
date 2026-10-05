// Builds the project site into _site/ for GitHub Pages: the pages in site/, the example viewers
// from docs/examples, the brand icons, LogicTrail's query-term code bundled for the browser, the
// sample flows the landing page's demo draws from, and CHANGELOG.md rendered into the page.
// Run after `npm run build` (it reads dist/): npm run site
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { marked } from "marked";
import { tokenize } from "../dist/query/terms.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "_site");
const from = (...parts) => path.join(root, ...parts);
const copy = (source, target) => {
  fs.mkdirSync(path.dirname(path.join(out, target)), { recursive: true });
  fs.copyFileSync(from(source), path.join(out, target));
};
const { version } = JSON.parse(fs.readFileSync(from("package.json"), "utf8"));

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(from("site"), out, { recursive: true });

// Brand: the web icons at the root (site.webmanifest refers to them relatively), the lockups, and
// the social preview image.
fs.cpSync(from("docs/brand/web"), out, { recursive: true });
for (const name of ["logictrail-horizontal.svg", "logictrail-horizontal-dark.svg"]) {
  copy(`docs/brand/logo/${name}`, `assets/brand/${name}`);
}
copy("docs/brand/social/logictrail-social.png", "og.png");

// The plugin page plays this clip; never deploy a player without it.
for (const clip of ["assets/logictrail-claude.mp4", "assets/logictrail-claude.jpg"]) {
  if (!fs.existsSync(path.join(out, clip))) throw new Error(`site/${clip} is missing.`);
}

// The live demo: the self-contained viewers, and the steps of each sample flow for the storm.
const SAMPLES = ["checkout", "login", "payment-failure"];
for (const name of SAMPLES) copy(`docs/examples/${name}.html`, `examples/${name}.html`);
const flows = SAMPLES.map((name) => sampleFlow(name));

// The storm splits questions with the same code LogicTrail uses, bundled for the browser.
await esbuild.build({
  stdin: {
    contents:
      'export { splitWords, normalizeWords, queryTerms, stem } from "./src/query/terms.ts";',
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  globalName: "LogicTrailTerms",
  target: "es2020",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  outfile: path.join(out, "assets/terms.js"),
});

const changelog = renderChangelog(fs.readFileSync(from("CHANGELOG.md"), "utf8"));
const flowData = JSON.stringify(flows).replaceAll("<", "\\u003c");
for (const page of htmlPages(out)) {
  const html = fs
    .readFileSync(page, "utf8")
    .replaceAll("{{version}}", version)
    .replace("<!-- build:changelog -->", changelog)
    .replace(
      "<!-- build:flows -->",
      `<script id="flows" type="application/json">${flowData}</script>`,
    );
  fs.writeFileSync(page, html);
}
console.log(`Built _site/ (LogicTrail ${version}).`);

/** A sample flow's steps in flow order (breadth-first from the entry points, as the viewer reads it). */
function sampleFlow(name) {
  const graph = JSON.parse(fs.readFileSync(from(`docs/examples/${name}.json`), "utf8"));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of graph.edges)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  const order = [];
  const seen = new Set();
  const queue = [...graph.entryPoints];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id) || !nodes.has(id)) continue;
    seen.add(id);
    order.push(nodes.get(id));
    for (const edge of outgoing.get(id) ?? []) queue.push(edge.to);
  }
  for (const node of graph.nodes) if (!seen.has(node.id)) order.push(node);
  return {
    id: name,
    question: graph.query,
    viewer: `examples/${name}.html`,
    edges: graph.edges.length,
    inferred: graph.edges.filter((edge) => edge.source === "inferred").length,
    files: graph.analysis.stats.files,
    steps: order.map((node) => ({
      label: node.label,
      type: node.type,
      file: node.file ?? null,
      line: node.line ?? null,
      terms: [...new Set(tokenize(node.label))],
    })),
  };
}

/** CHANGELOG.md as one <article> per release, newest first; an empty Unreleased is left out. */
function renderChangelog(markdown) {
  const links = new Map(
    [...markdown.matchAll(/^\[([^\]]+)\]:\s*(\S+)\s*$/gm)].map((match) => [match[1], match[2]]),
  );
  const body = markdown.replace(/^\[[^\]]+\]:\s*\S+\s*$/gm, "");
  const sections = body.split(/^## /m).slice(1);
  return sections
    .map((section) => {
      const [heading = "", ...rest] = section.split("\n");
      const [, name = heading.trim(), date] = /^\[([^\]]+)\](?:\s*-\s*(\S+))?/.exec(heading) ?? [];
      const notes = rest.join("\n").replace(/^### /gm, "#### ").trim();
      if (!notes) return "";
      const link = links.get(name);
      const title = link ? `<a href="${link}">${name}</a>` : name;
      const time = date
        ? `<time datetime="${date}">${new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}</time>`
        : "";
      return `<article class="release" id="v${name}">
  <header class="release-head"><h3 class="release-version">${title}</h3>${time}</header>
  <div class="release-notes">${marked.parse(notes)}</div>
</article>`;
    })
    .join("\n");
}

function htmlPages(dir) {
  return fs
    .readdirSync(dir, { recursive: true })
    .map((file) => path.join(dir, file))
    .filter((file) => file.endsWith(".html") && !file.includes(`${path.sep}examples${path.sep}`));
}
