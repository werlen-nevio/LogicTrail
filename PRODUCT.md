# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Project site (confirmed 2026-10-05): static HTML/CSS, hand-written pages plus a small Node build
script in `scripts/`, deployed to GitHub Pages by a workflow (`werlen-nevio.github.io/LogicTrail`,
Pages enabled by the maintainer). The product itself is a TypeScript CLI and library on Node 22+.

## Users

- **Primary audience of the project site (confirmed):** developers who already work in Claude
  Code and want Claude to explain how a feature of their JavaScript/TypeScript codebase works.
  Their way in is the plugin (`/logictrail:explain`, `/logictrail:update`); the CLI comes second.
- Other users (from the README, not ranked): developers facing an unfamiliar JS/TS codebase (new
  to a team, reviewing code), and people who want evidence-backed flow diagrams for docs.

## Product Purpose

LogicTrail answers "how does this work?" about a codebase by tracing the execution path the code
actually takes (components, API routes, services, database calls, events, external APIs and the
branches between them), with the file and line behind every step. It writes an interactive HTML
viewer, SVG, Mermaid and JSON. Success: a developer understands one flow in minutes and can trust
each step because it cites the code.

## Positioning

Evidence first. Every static edge carries the call site that proves it; relationships that are
likely but unproven are labelled inferred, with a confidence and a reason. Claude only selects and
describes inside a sub-graph that static analysis found, and anything it returns that the analysis
did not find is dropped. It answers one question at a time and draws only the code that answers
it: it is not a dependency visualizer. It works without an API key (static analysis); Claude
improves selection, descriptions and explanations.

## Operating Context

- CLI: `npx logictrail "<question>"` in a repository writes `.logictrail/<slug>.html` (and other
  formats); `--route`, `--file`, `--function` start from a code location; `logictrail update`
  re-runs saved flows and lists what changed.
- Claude Code plugin: `/logictrail:explain <question>` has Claude run LogicTrail, read the flow and
  walk the user through it step by step, citing file and line; `/logictrail:update [flow]` re-runs
  saved flows and explains what changed. Install with `/plugin marketplace add
werlen-nevio/LogicTrail` then `/plugin install logictrail@logictrail`.
- Node.js 22+. Published on npm as `logictrail` (0.2.0, 2026-10-05). MIT. Source at
  github.com/werlen-nevio/LogicTrail. Sample app in `examples/acme-shop`.

## Capabilities and Constraints

- JavaScript and TypeScript only (TypeScript compiler API), with adapters for Express, Next.js,
  React, Prisma, Stripe and more (README "Supported frameworks" is the source of truth).
- Sent to Claude: the question, candidate nodes, edges and source excerpts (about 60k characters
  at most). `--model static` keeps everything local.
- Known limitations: dynamic dispatch and runtime DI are not linked; monorepo workspace packages
  are treated as external; the first run parses every file.
- Roadmap items (PNG export, other languages, other LLM providers, monorepo resolution, editor
  integrations, diff mode) are not shipped and must not be presented as features.

## Brand Commitments

- Logo "Two Steps" (`docs/brand/`): two offset pills climbing to the upper right. The first
  (lower-left) step is always Waymark Yellow `#FFC400`; the second step and the wordmark take the
  text colour (Ink `#16171B` on light, white on dark). Yellow never alone on a light background
  and never as text on light. Under 24 px use the yellow tile. Use the lockup files; never
  typeset "LogicTrail" next to the symbol.
- Text next to the logo uses the system UI stack the viewer uses; code uses its monospace stack
  (brand kit guidance).
- Tagline: "Ask your codebase how it works."
- Voice: plain, precise and evidence-minded; short declarative sentences, no hype.
- Web icons and manifest in `docs/brand/web/` (theme colour `#16171B`).

## Evidence on Hand

- Live, self-contained example viewers generated from the sample app with static analysis:
  `docs/examples/login.html`, `checkout.html`, `payment-failure.html` (plus `.svg`, `.mmd`,
  `.json`).
- README screenshots `docs/assets/viewer-*.png` (outdated: they show the old blue logo).
- Brand presentation boards `docs/brand/presentation/*.png`.
- `CHANGELOG.md` (0.1.0 and 0.2.0, both 2026-10-05).
- Absent and not to be fabricated: users, testimonials, GitHub stars, download counts,
  benchmarks, a company behind it. There is no pricing; it is free and MIT-licensed.

## Product Principles

1. Prove, don't claim: every step cites its file and line, and the site shows real flows rather
   than pictures of them.
2. One question, one trail: show only the code that answers the question.
3. Honest uncertainty: what is inferred says so, with how sure and why.
4. Local first: it works without an API key, and says exactly what is sent to Claude.
