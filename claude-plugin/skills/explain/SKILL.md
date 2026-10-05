---
name: explain
description: Explain how a feature of this codebase works by tracing the execution path the code actually takes (components, API routes, services, database calls, events, external APIs and the branches between them) with LogicTrail, citing the file and line behind every step. Use when the user asks how something works, what happens when or after X, where a request or event goes, or what code runs for a route, function or file in a JavaScript/TypeScript project.
argument-hint: <question> | --route "POST /api/orders" | --function name | --file path
allowed-tools: Read, Grep, Bash(logictrail *), Bash(npx --no-install logictrail *), Bash(npx -y logictrail *), Bash(logictrail-outline *)
---

# Explain a flow with LogicTrail

The request: `$ARGUMENTS`

If the request is empty, ask the user what they want explained (for example "how does checkout work?") and stop.

Run every command below with the Bash tool, one command per call, from the current directory: no `cd`, no `&&`.
That way they match this skill's permissions and run without prompts.

## 1. Find the LogicTrail CLI

Try these in order and use the first that prints a version:

1. `logictrail --version` (installed globally, or `npm link` from a LogicTrail checkout)
2. `npx --no-install logictrail --version` (a dev dependency of this project)
3. `npx -y logictrail --version` (downloads it from npm)

If none works, stop and tell the user to install it: the npm package is `logictrail` (unscoped), so
`npm install --save-dev logictrail`, or `npm link` in a LogicTrail checkout. It needs Node.js 22 or newer.

## 2. Run it

Run from the project root, with the CLI you found in place of `logictrail`:

```bash
logictrail '<question>' --output json,html
```

- Pass the request as the question, wrapped in single quotes (escape any `'` inside). If it starts with `--` (e.g.
  `--route "POST /api/orders"`, `--function createSession`, `--file src/cart.ts`, `--model static`), pass those
  flags through as they are instead.
- Progress goes to stderr. stdout lists the files it wrote, normally `.logictrail/<question-slug>.json` and `.html`.
- It can take a while on a large repository the first time; later runs reuse its cache.
- If `ANTHROPIC_API_KEY` is set, LogicTrail uses Claude to pick the relevant code; otherwise it uses static analysis.
  Both are fine here.

If it fails, report the error in a sentence and suggest the fix it names. Common cases: not at the project root (pass
`--root <dir>`), or no flow found (ask a narrower question, or start from `--function`, `--route` or `--file`).

## 3. Read the result

Do not read the JSON file directly: it embeds source snippets and is large. Print a compact outline instead:

```bash
logictrail-outline .logictrail/<question-slug>.json
```

(`logictrail-outline` comes with this plugin and is on the Bash tool's PATH.)

The outline lists every step in flow order as `[n] <type> <label> — <file>:<line>`, with its outgoing edges (calls,
reads, writes, emits, condition branches). Edges marked `inferred NN%` are likely but not proven by a call site.

Then read the source at the steps that matter most for the answer (the entry point, conditions and branches, writes
and external calls), so you can say what each step does, not just its name. Keep these reads targeted.

## 4. Answer

1. Answer the question directly in two or three sentences.
2. Walk through the path as a numbered list in flow order. Each step says what happens and cites its location as you
   normally reference code (file and line). Group trivial steps; keep the ones that change state, call out, or decide.
3. Call out the branches: which condition decides, and where each arm leads (including error exits and status codes).
4. Mark inferred links as inferred. Do not add steps the outline doesn't contain; if you add something from reading
   the code, say that it comes from your reading, not from the trace.
5. Mention any warnings from the outline that affect the answer.
6. End with the path to the interactive viewer (`.logictrail/<question-slug>.html`) and offer to open it in the browser.
   Mention that `/logictrail:update <question-slug>` refreshes the flow after the code changes.
