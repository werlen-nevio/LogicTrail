# Changelog

All notable changes to LogicTrail are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The npm package and the
Claude Code plugin share one version number.

## [Unreleased]

### Added

- `--show-prompt` prints the prompt LogicTrail would send to Claude (the system prompt, the
  candidate steps, the edges and the source excerpts) without sending it or writing any files. It
  needs no API key. `buildFlowPrompt` does the same in the library API.
- A JSON Schema for the graph output, `schema/graph-v1.schema.json`. JSON files point to it with
  `$schema`, and the package exports it as `logictrail/graph.schema.json`.
- Routes for Fastify (`fastify.get`, `fastify.route`, route hooks and `register` prefixes), Hono
  (`app.route` sub-apps and `basePath`), Koa (`@koa/router` and `koa-router` prefixes and nested
  `router.routes()`) and NestJS (`@Controller` methods decorated with `@Get`, `@Post` and so on).
  Each route records its framework and is matched by `--route` and by client requests like an
  Express route.
- For NestJS:
  - `@UseGuards`, `@UseInterceptors` and `@UsePipes` on a controller or method are steps before the
    handler, in the order Nest runs them, linked to `canActivate`, `intercept` and `transform`.
  - `app.setGlobalPrefix` applies to the controllers in that app's module tree
    (`NestFactory.create(AppModule)`) and honors `exclude`.
  - `RouterModule.register` paths prefix the controllers of their module.
  - `@Version` and `@Controller({ version })` follow `app.enableVersioning`. URI versions are part of
    the path (`/v1/cats`); header, media type and custom versions are in the route's label, as in
    `POST /v2/bookings (version 2024-08-13)`. `--route` takes the same suffix to pick a version,
    and without one picks the routes that serve the default version.

- Next.js cache and request APIs are steps: `revalidateTag`, `revalidatePath`, `updateTag` and
  `refresh` from `next/cache` (labelled with the tag or path, e.g. `updateTag("cart")`), and the
  `get`, `set`, `has` and `delete` operations on `cookies()` and `headers()` from `next/headers`
  (e.g. `cookies().get("cartId")`).
- Express middleware that a package creates and the repository names, such as
  `auth.required = expressjwt({ … })` used as `router.get("/articles/feed", auth.required, …)`, is
  a step before the handler.

### Changed

- The HTML and JSON files no longer contain the absolute path of the analyzed root, which named
  the local user and folder layout. `analysis.rootPath` now says where the root is relative to the
  file (`..` for the default `.logictrail/`), and is left out when the file is written outside the
  repository. `analyze()` no longer sets it; `writeOutputs` does when given `root`. "Open in
  editor" works as before for files opened from disk inside the repository. The README describes
  what the output files contain.

### Fixed

- Express routers created and configured in one expression keep their mount prefixes:
  `const api = Router().use(tags).use(auth)` and `export default Router().use("/api", api)` are
  recorded under `api` and the default export, every `.use()` in the chain counts, and the routes
  behind them get `/api`. In the RealWorld example app, `--route "POST /api/users/login"` now finds
  the route, which was listed as `POST /users/login`.
- `--route` matches pages (Next.js App and Pages Router, React Router) as well as server routes:
  `--route "GET /search"`, `--route "/product/[handle]"` or `--route "GET /product/:handle"` start
  the flow at the page component. A path without a method or with `GET` matches a page when no
  server route serves it. When nothing matches, the closest pages are listed with the routes, as in
  `Available: GET /search (page SearchPage)`.
- Imports of packages that live in the repository (monorepo workspaces such as
  `@calcom/features/bookings/lib/service/RegularBookingService`) resolve to their sources instead
  of being treated as npm packages. LogicTrail finds them from the `package.json` files around the
  indexed sources and follows `exports`, `main` and `types`, mapping built entries (`dist/…`) back
  to `src/`. Methods inherited from a base class in another package are linked: in cal.com,
  `this.regularBookingService.createBooking(…)` now reaches `RegularBookingService.createBooking`
  through `extends BaseRegularBookingService`, and the code graph has 14,676 edges where it had
  9,056.
- A method called through `this` on one of the repository's classes that is not found on the class
  or its `extends` chain (a mixin base, a base outside the indexed files, a property whose value
  can't be followed) is an unresolved step with confidence 0.5 instead of being dropped.

- Broad questions keep the core of a flow instead of spreading the node budget over many starting
  points:
  - A match is weighed by how much of the question it covers, so "what happens when an article is
    created?" no longer pulls in `createUser`.
  - Near-identical versioned symbols (`SlotsController_2024_04_15`, `SlotsController_2024_09_04`)
    count as one starting point.
  - A symbol that another starting point already reaches isn't a starting point of its own.
  - One file gives at most three starting points.
  - Tests, mocks and fixtures rank below the code they exercise.
  - The flow grows best first: priority falls with each step away from a starting point and rises
    with a node's own relevance, so trimming drops distant leaves before the path through the
    matching code.

  In cal.com, "how are available slots calculated?" now gives 37 nodes around
  `AvailableSlotsService.getAvailableSlots`, where it gave 102, 88 of them API v2 controllers and
  mappers.

- `--name` keeps the case of the name it's given (`--name fn-addItem` writes `fn-addItem.*`, not
  `fn-additem.*`) and only replaces characters that aren't safe in file names.
- An HTTP request whose URL can't be resolved to a string is labelled with the expression it was
  written as. `fetch(endpoint, { method: "POST" })`, where `endpoint` is a conditional that can be
  `""`, was labelled `POST ` and is now `POST endpoint`; an unresolved `fetch`, axios, ky or got URL
  no longer shows the whole call.
- A response whose status isn't a number literal, like
  `NextResponse.json({ message }, { status: e.statusCode })` or `res.status(code).json()`, is
  labelled `Response (status: e.statusCode)` instead of `200 OK`.
- When `--route` matches nothing, the routes it suggests are the closest ones instead of the first
  eight found: routes with the same method first, then those sharing the most path segments, then
  the smallest edit distance. `GET /users/:id` suggests `GET /api/users/:id` first.
- Calls to members destructured from a function's return value are followed:
  `const { addCartItem } = useCart(); addCartItem()` now links to `addCartItem` when `useCart`
  returns an object literal, directly or from `useMemo(() => ({ … }))`. `const cart = useCart();
cart.addCartItem()` works the same way. Calling the dispatcher from React's `useReducer` or
  `useOptimistic` now links to the reducer.

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
[0.2.0]: https://github.com/werlen-nevio/LogicTrail/releases/tag/v0.2.0
