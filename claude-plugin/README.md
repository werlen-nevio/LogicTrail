# LogicTrail for Claude Code

Ask Claude how a feature works and get the path the code actually takes, with the file and line behind every step.

```text
/logictrail:explain how does checkout work?
/logictrail:explain --route "POST /api/orders"
/logictrail:explain --function createSession
```

Claude runs LogicTrail in your project, reads a compact outline of the flow (`logictrail-outline`, included), checks the
source at the key steps and walks you through the path: entry point, calls, database reads and writes, events, external
APIs and the branches between them. It ends with the interactive viewer (`.logictrail/<question>.html`).

You don't have to type the command: Claude also uses it when you ask "how does … work?" or "what happens when …?".

## Install

1. Install the LogicTrail CLI (Node.js 22+), either in your project or globally:

   ```bash
   npm install --save-dev logictrail
   ```

   From a LogicTrail checkout, `npm install && npm run build && npm link` puts `logictrail` on your PATH instead.

2. Add the plugin in Claude Code:

   ```text
   /plugin marketplace add werlen-nevio/LogicTrail
   /plugin install logictrail@logictrail
   ```

   To try it without installing, start Claude Code with `claude --plugin-dir path/to/LogicTrail/claude-plugin`.

LogicTrail uses static analysis by default. With `ANTHROPIC_API_KEY` set, it also uses Claude to select the relevant code.
Add `.logictrail/` to your `.gitignore`.

## What's inside

| Path                         | What it is                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `skills/explain/SKILL.md`    | The `/logictrail:explain` command                                                    |
| `bin/logictrail-outline`     | Prints a compact, step-by-step outline of a LogicTrail JSON graph                    |
| `scripts/summarize.mjs`      | The outline script (plain Node.js, no dependencies)                                  |
| `.claude-plugin/plugin.json` | Plugin manifest. The marketplace entry is in the repository root's `.claude-plugin/` |
