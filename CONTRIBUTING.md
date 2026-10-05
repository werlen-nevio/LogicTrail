# Contributing to LogicTrail

Thanks for helping. This guide covers the development setup and the two most common
contributions: framework adapters and language adapters.

## Setup

```bash
git clone https://github.com/werlen-nevio/LogicTrail.git
cd LogicTrail
npm install
npm run check        # typecheck, lint, format check, tests
```

Useful scripts:

| Script                               | What it does                                           |
| ------------------------------------ | ------------------------------------------------------ |
| `npm run dev -- "<question>" ...`    | Run the CLI from source                                |
| `npm run demo`                       | Analyze the sample app and write every output format   |
| `npm test` / `npm run test:watch`    | Vitest                                                 |
| `npm run build`                      | Compile to `dist/` and bundle the browser viewer       |
| `npm run test:package`               | Install the packed CLI and run it (after a build)      |
| `node scripts/generate-examples.mjs` | Regenerate `docs/examples` (run after `npm run build`) |
| `npm run site`                       | Build the website into `_site/` (pages in `site/`)     |
| `npm run site:preview`               | Serve `_site/` at http://localhost:4173/LogicTrail/    |

Node.js 22 or newer is required.

## How the code is organized

Facts flow in one direction:

```text
lang/ (per file, cached)  →  analysis/ (cross-file)  →  query/  →  llm/  →  flow/  →  render/
```

- `lang/javascript` turns one file into `FileFacts` (`src/indexer/facts.ts`). It must be a pure
  function of path and content, because facts are cached by content hash. Bump `FACTS_VERSION`
  (or the adapter's `version`) whenever extraction output changes.
- `analysis/workspace.ts` resolves identifier paths across files. `analysis/code-graph.ts` turns
  facts into nodes and evidence-backed edges, and framework adapters classify calls.
- `query/` finds the relevant sub-graph, `llm/` lets a provider pick from it, and `flow/` builds
  the final `LogicTrailGraph`.

## Adding a framework adapter

Framework adapters live in `src/analysis/adapters/`. An adapter receives a call site and the
resolved value of its callee, and returns a classification or `undefined`:

```ts
export const myQueueAdapter: FrameworkAdapter = {
  name: "my-queue",
  classify({ value, call }) {
    const pkg = packageValue(value);
    if (!pkg || !isPackage(pkg, "my-queue") || pkg.member[0] !== "publish") return undefined;
    const topic = stringArg(call.args[0]);
    return topic
      ? { kind: "emit", channel: "queue", event: topic, confidence: 1, system: "my-queue" }
      : undefined;
  },
};
```

`value` tells you where the callee came from. For `queue.publish("x")`, where
`const queue = new Client()` and `Client` is imported from `my-queue`, you get
`{ pkg: "my-queue", imported: "Client", ops: [{ op: "new", ... }], member: ["publish"] }`.

Register the adapter in `src/analysis/adapters/index.ts`, then add a test in
`test/analysis.test.ts` (or a fixture under `test/fixtures/`). Keep adapters conservative: a
missing edge is better than a wrong one.

## Adding a language

Implement `LanguageAdapter` (`src/lang/adapter.ts`):

1. `extract({ path, content, hash })` returns `FileFacts`: imports, exports, symbols with ordered
   steps (calls, references, branches, exits), routes, listeners and pages.
2. `createModuleResolver(context)` resolves import specifiers to repository files or packages.
3. Add the adapter to `src/lang/registry.ts`.

Everything downstream of the facts is language-neutral. Framework adapters match on package names
and member paths, so most of them carry over once a language's import model maps onto `ImportFact`.

## Pull requests

- Run `npm run check` before pushing.
- Add or update tests for behavior changes. Fixtures under `examples/` and `test/fixtures/` are
  excluded from formatting on purpose, because tests refer to their exact line numbers.
- Keep the evidence promise: anything that cannot be proven from source must be marked as
  inferred, with a confidence and a reason.

CI runs `npm run check` and `npm run test:package` on Ubuntu and Windows, validates the Claude
plugin and its marketplace with `claude plugin validate --strict`, and runs
`node scripts/release.mjs`, which checks that `package.json`, the plugin and `CHANGELOG.md` agree.

## Releasing

The npm package and the Claude plugin share one version number.

1. In `CHANGELOG.md`, move the notes under `[Unreleased]` to a new `## [x.y.z] - YYYY-MM-DD`
   section and add its compare link at the bottom.
2. Set `x.y.z` in `package.json` (`npm version x.y.z --no-git-tag-version`) and in
   `claude-plugin/.claude-plugin/plugin.json`, then run `node scripts/release.mjs`.
3. Commit and push a tag: `git tag vx.y.z && git push origin main vx.y.z`.

The [release workflow](.github/workflows/release.yml) then publishes `logictrail` to npm with
provenance, creates the GitHub Release from the changelog entry and tags the plugin release
(`logictrail--vx.y.z`, with `claude plugin tag`). A prerelease tag such as `v1.0.0-beta.1` goes to
npm's `next` dist-tag and becomes a GitHub prerelease. If a step fails, fix the cause and re-run
the workflow: steps that already succeeded are skipped.

npm trusts the workflow by its file name (trusted publishing), so no npm token is stored. If you
rename `release.yml`, update the trusted publisher in the package settings on npmjs.com.
