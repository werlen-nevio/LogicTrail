---
version: 1
slug: "site-index-html"
primary_target: "site/index.html"
related_targets: ["site/claude/index.html"]
---

## Scope

Project site on GitHub Pages: landing page (`site/index.html`) and the Claude Code plugin page
(`site/claude/index.html`), sharing one stylesheet and one storm script. Visitor mode: Persuade.

## Audience and action

Developers who already work in Claude Code. They should leave believing LogicTrail gives them a
cited, step-by-step walk through a real flow, and act by installing the plugin (two `/plugin`
commands, copyable, in the first viewport). The CLI (`npx logictrail`) is the secondary action.

## Proof on hand

The three sample flows from `examples/acme-shop` (login, checkout, payment failure), as JSON for
the storm and as live, self-contained viewers for the demo. LogicTrail's own query-term code
(`src/query/terms.ts`), bundled for the browser, decides which words are set aside and which condense.
CHANGELOG.md, rendered at build time. No invented users, stars, counts or quotes.

## Direction contract

THESIS: Language becomes landscape. The visitor's question is set as monumental type; its filler
words are blown aside and settle grey, its search terms condense, and the code path they match is carved
below as a trail of real steps with file and line. Refuses the dark terminal-mock hero over a
three-up feature grid.

OWN-WORLD: White paper ground; Ink #16171B as both body ink and weather mass; Waymark Yellow
#FFC400 as the one flash, a highlight band behind Ink letters mid-transformation and the first
step of every trail, never yellow text on white; rain grey #8E949B for spent grammar; mist
#E6E8EB hairline rules dividing the page into ruled panels. Mona Sans black at its narrowest
width for the monumental type, tracked capitals for labels, the system UI stack for body copy
(brand kit), the viewer's monospace for code, file and line. Square-cornered solid Ink buttons
with tracked capitals. One Ink-drenched band where yellow works at full strength.

STORY: The visitor watches their question turn into a trail, understands that every step cites the
code, sees the real viewer, then copies two commands into Claude Code. The plugin page shows what
Claude says back and what update reports.

FIRST VIEWPORT: Ruled header (lockup left, five links right). Below, the left 60% is the field:
the question at about 11vw in Mona Sans, three lines, storming once on load; under it the H1
"Ask your codebase how it works.", one sentence, and the install panel with both commands and copy
buttons. The right 40% is the trail: up to eight real steps with file:line, joined by one
vertical rule, the first step on yellow. Question presets and a free input sit under the field.

FORM: Alphabet Storm (dealt challenger, adopted by the user over the assigned Commentary, which
ranked 3rd on the grounded list); seed key 1ee66f07. Signature interaction: type or pick a
question and it storms into its trail. Motion grammar: words split, scatter and settle, terms condense once per
viewport; reduced motion shows the settled state.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Demo clip for the plugin page: made in this session with the brag skill after the site exists.
- GitHub social preview upload is manual (no API); the image ships in the site build.
