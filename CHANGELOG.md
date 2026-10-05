# Changelog

All notable changes to LogicTrail are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The npm package and the
Claude Code plugin share one version number.

## [Unreleased]

## [0.2.0] - 2026-10-05

### Added

- `logictrail update [flow...]` re-runs the flows saved in `.logictrail/` with the question or
  starting point and the limits they were made with, rewrites them in the formats they were saved
  in (an SVG keeps its theme) and lists the steps that were added, removed or moved, and the
  connections gained or lost between them.
- Saved flows record how they were requested (`request` in the graph JSON), so they can be re-run.
- `updateFlow`, `findSavedFlows`, `loadSavedFlow`, `diffFlows` and `hasChanges` in the library API.
- A Claude Code plugin. `/logictrail:explain` runs LogicTrail on a question and walks you through
  the flow, citing the file and line behind every step; `/logictrail:update` re-runs saved flows
  and explains what changed. Install it with `/plugin marketplace add werlen-nevio/LogicTrail`
  and `/plugin install logictrail@logictrail`.

### Changed

- New logo. The HTML viewer's header and favicon and the README use the Two Steps mark in Waymark
  Yellow and Ink; the brand kit is in `docs/brand`.

## [0.1.0] - 2026-10-05

Initial release.

### Added

- `logictrail "<question>"` turns a plain-English question about a JavaScript or TypeScript
  codebase into the execution flow behind it (components, API routes, services, database calls,
  events, external APIs and the branches between them), with the file and line behind every step.
- `--route`, `--file` and `--function` start a flow from an HTTP route, a file or a function
  instead of a question.
- Output as an interactive HTML viewer, SVG (light, dark or auto theme), Mermaid and JSON.
  `--open` opens the result in the browser and `--stdout` prints a single format.
- Works without an API key through static analysis. With `ANTHROPIC_API_KEY` set, Claude selects
  the flow and writes the descriptions and explanations (`--model` picks the model).
- Framework adapters for Express, Next.js, React, React Router, HTTP clients, ORMs and database
  drivers, event emitters and queues, and external APIs such as Stripe and Resend.
- `logictrail.config.ts` configuration, a per-file analysis cache and a library API (`analyze`,
  `writeOutputs`).

[Unreleased]: https://github.com/werlen-nevio/LogicTrail/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/werlen-nevio/LogicTrail/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/werlen-nevio/LogicTrail/releases/tag/v0.1.0
