---
name: update
description: Update saved LogicTrail flows (in .logictrail/) after the code changed, re-running them with the question or starting point they were made with, and explain what changed in the code path. Use when the user asks to update, refresh or re-run a flow or diagram, or asks whether a saved flow is still accurate.
argument-hint: "[flow name or words from it, e.g. checkout; empty = every flow]"
allowed-tools: Read, Grep, Glob, Bash(logictrail *), Bash(npx --no-install logictrail *), Bash(npx -y logictrail *), Bash(logictrail-outline *)
---

# Update saved flows with LogicTrail

The request: `$ARGUMENTS`

Run every command below with the Bash tool, one command per call, from the current directory: no `cd`, no `&&`.
That way they match this skill's permissions and run without prompts.

## 1. Find the LogicTrail CLI

Try these in order and use the first that prints a version:

1. `logictrail --version`
2. `npx --no-install logictrail --version`
3. `npx -y logictrail --version`

If none works, tell the user to install it: the npm package is `logictrail` (unscoped), so
`npm install --save-dev logictrail`, or `npm link` in a LogicTrail checkout.

Then run `logictrail update --help` (with the CLI you found). If its first line is not `Usage: logictrail update`,
this LogicTrail is too old to update flows: tell the user to upgrade it and stop. Never run `logictrail update …` on an
old version, because it would treat "update" as the start of a question.

## 2. Pick the flows

Saved flows are the `.json` and `.html` files in `.logictrail/` (or the `outputDir` in `logictrail.config.*`). List
them with the Glob tool. A flow's name is its file name without the extension, e.g. `how-does-checkout-work`.

- Empty request: update every flow.
- Otherwise, use the flow whose name matches the request exactly, or contains all of its words ("checkout" →
  `how-does-checkout-work`). If several match, update all of them only if the user said so; otherwise list them and
  ask which one.
- No match: say which flows exist, and offer `/logictrail:explain` to create the one they meant.
- No saved flows at all: say so and offer `/logictrail:explain`.

## 3. Update

```bash
logictrail update <name> [<name> …]
```

With no names it updates every flow. Progress goes to stderr; for each flow it prints either `<name>: no changes` or
a summary followed by the changed steps:

- `+ <label> (<type>) <file>:<line>`: a step that is new in the flow
- `− <label> …`: a step that is gone
- `~ <label>  <old file:line> → <new line or location>`: the same step, now somewhere else
- `+ <step> → <step> (<type>)` / `− <step> → <step> (<type>)`: a connection gained or lost between steps that are
  in both versions, e.g. a call that no longer happens. These are often the most important changes.

stdout lists the files it rewrote. Pass through flags the user gave (`--model static`, `--max-nodes 80`, …). If it
fails, report the error in a sentence and the fix it suggests.

## 4. Explain what changed

- If every flow says `no changes`, say the flows are up to date and stop.
- For each flow that changed, print its new outline: `logictrail-outline .logictrail/<name>.json` (or `.html` when it
  has no JSON). `logictrail-outline` comes with this plugin and is on the Bash tool's PATH.
- Read the source at the added and removed steps and connections so you can say what the change means for the flow:
  a new database write, a call that is gone, a new branch or error exit. Cite each with its file and line. Say only
  what the report and the code show; don't guess why lines moved.
- Steps that only moved (the same file, a different line) usually mean code above them changed. Mention them
  briefly as a group unless a move changes the order of the flow.
- Keep it short: what changed in the path, then where to look. End with the path to the updated viewer
  (`.logictrail/<name>.html`, when it has one).
