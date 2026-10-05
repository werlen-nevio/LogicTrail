---
name: LogicTrail
description: Ask your codebase how it works.
colors:
  paper: "#ffffff"
  ink: "#16171b"
  waymark-yellow: "#ffc400"
  rain: "#8e949b"
  graphite: "#5d6169"
  mist: "#e6e8eb"
  fog: "#f4f5f6"
  ink-rule: "#2e3036"
  on-ink-2: "#a9adb5"
typography:
  question:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(3.25rem, 10vw, 10rem)"
    fontWeight: 900
    lineHeight: 0.88
    letterSpacing: "0.006em"
    fontVariation: "'wdth' 75"
  display:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 7.4vw, 6rem)"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "0.012em"
    fontVariation: "'wdth' 75"
  display-code:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, JetBrains Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "clamp(2.1rem, 5vw, 4.5rem)"
    fontWeight: 700
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 2.7vw, 2.6rem)"
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 750
    lineHeight: 1.35
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0.14em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, SF Mono, JetBrains Mono, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "0.875em"
    fontWeight: 400
rounded:
  none: "0px"
  code-chip: "3px"
  step-pill: "0.32rem"
spacing:
  gutter: "clamp(1rem, 3.2vw, 2.75rem)"
  section: "clamp(4.5rem, 9vw, 7.5rem)"
  section-head: "clamp(2.5rem, 5vw, 4rem)"
  panel: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 1.5rem"
    height: "3rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 1.5rem"
    height: "3rem"
  button-lit:
    backgroundColor: "{colors.waymark-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 1.5rem"
    height: "3rem"
  button-copy:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 0.7rem"
    height: "2.25rem"
  button-copy-done:
    backgroundColor: "{colors.waymark-yellow}"
    textColor: "{colors.ink}"
  chip-try:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 0.85rem"
    height: "2.25rem"
  chip-try-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  term-tile:
    backgroundColor: "{colors.waymark-yellow}"
    textColor: "{colors.ink}"
    padding: "0 0.3em"
  install-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0.85rem 1rem"
  ink-band:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    padding: "{spacing.section}"
---

# Design System: LogicTrail

## Overview

**Creative North Star: "Alphabet Storm"**

Language becomes landscape. The visitor's question is set as monumental, narrow, black capitals; the words LogicTrail sets aside are blown aside and settle grey, the search terms condense under a Waymark Yellow tile, and the code path they match is carved beside them as a trail of real steps with file and line. Everything else on the page is a ruled sheet of white paper that holds that weather still: hairline panels, Ink frames, square controls, tracked-capital labels, monospace evidence.

The system is flat, white and dense with fact. Depth comes from ink weight (1px mist hairlines against 1.5px Ink frames) and from a single Ink-drenched band per page, never from shadows or rounded cards. Yellow is the one flash and it is always attached to Ink: a tile behind Ink letters, the first step of a trail, the first numbered item, a state underline beneath Ink text. The world refuses the dark terminal-mock hero over a three-up feature grid.

The same world carries the product film (`site/assets/logictrail-claude.mp4`, poster `.jpg`) and the social card (`docs/brand/social/logictrail-social.png`, source `social-card.html`).

**Key Characteristics:**

- Monumental Mona Sans at weight 900, width 75%, uppercase, for the question and section displays.
- White paper divided into ruled panels by mist hairlines; Ink frames for the panels that matter.
- Waymark Yellow only as a tile or underscore paired with Ink, or at full strength on the one Ink band.
- Code, commands and file:line always in the monospace stack; body copy in the system UI stack.
- Square corners, no shadows, motion that happens once per viewport and settles.

## Colors

A white-paper and Ink palette with one flash of Waymark Yellow and a short ladder of greys, each with a fixed job.

### Primary

- **Waymark Yellow** (`waymark-yellow`): the brand step colour. Used as a tile behind Ink text (the search-term tile in the question, `<mark>` on matched code in trail steps, the searched-term pill, the first trail step, the first numbered answer step, the first process stage, the add sign in diffs, the call-site line number, the "Latest" badge, the lit button, the copied state), as a 2-3px underscore beneath Ink text for current nav and selected tab, as text selection, and at full strength as text on the Ink band (command names, added lines).

### Neutral

- **Paper** (`paper`): the ground of every page; text on the Ink band.
- **Ink** (`ink`): body text, Ink frames (1.5px), solid buttons, the trail's vertical rule and hit steps, and the single drenched band. Also the theme colour.
- **Rain** (`rain`): spent grammar. The set-aside words of the question once they have settled, the inferred-confidence figure, dashed inferred edges, link underlines at rest. Large type and strokes only.
- **Graphite** (`graphite`): all small secondary text: nav links at rest, file:line, step types, hints, captions, table heads, dates, footer.
- **Mist** (`mist`): 1px hairline rules that divide the page into panels; resting borders of copy buttons and question presets.
- **Fog** (`fog`): quiet fills: inline code chips, the "then ask" row of the install panel, call-site code, the viewer frame behind its iframe.
- **Ink Rule** (`ink-rule`): the hairline colour inside the Ink band, replacing mist.
- **On-Ink Secondary** (`on-ink-2`): secondary text and file:line on the Ink band.

### Named Rules

**The Yellow Holds Ink Rule.** Waymark Yellow never stands alone on white and is never text on a light ground. On paper it is a tile or underscore that always carries or underlines Ink text; only on the Ink band may it be text.

**The First Step Is Yellow Rule.** In any sequence (trail steps, numbered answer steps, process stages, releases) the first item alone takes the yellow tile; the rest stay Ink.

**The Rain Is Large Rule.** Rain grey is for large type, glyphs and strokes. Any small secondary text uses Graphite.

**The One Band Rule.** One Ink-drenched band per page, where hairlines switch to Ink Rule and yellow works at full strength.

## Typography

**Display Font:** Mona Sans (self-hosted variable subset, weights 200-900, widths 75-125%), with ui-sans-serif, system-ui
**Body Font:** the system UI stack (ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial)
**Label/Mono Font:** Mona Sans tracked capitals for labels; the viewer's monospace stack (ui-monospace, SFMono-Regular, SF Mono, JetBrains Mono, Menlo, Consolas) for code, commands and file:line

**Character:** A condensed black grotesque shouting the question, against a plain system voice that explains it and a monospace voice that proves it. The three never trade jobs.

### Hierarchy

- **Question** (900, width 75%, clamp(3.25rem, 10vw, 10rem), line-height 0.88, uppercase): the editable storming question in the hero, and the settled question on the 404.
- **Display** (900, width 75%, clamp(2.75rem, 7.4vw, 6rem), line-height 0.9, uppercase): section titles. When the title is a command, it switches to the monospace at 700 with -0.03em tracking and no case change. Release versions, the confidence figure and process numerals use the same narrow black face at smaller sizes.
- **Headline** (800, width 100%, clamp(1.75rem, 2.7vw, 2.6rem), line-height 1.04, -0.02em): the page H1 under the question.
- **Title** (750, 1.125-1.2rem, line-height 1.3-1.35): definition terms, format names, process stage titles.
- **Body** (400, 1.0625rem, line-height 1.6, system UI): prose capped at 62ch (48-68ch for narrower columns).
- **Label** (650, 0.7-0.78rem, 0.12-0.16em tracking, uppercase, Mona Sans): panel headings, nav, buttons, step types, table heads, figure captions.
- **Code** (monospace, 0.875em, 0.78-0.92rem for file:line and step labels): every command, path, identifier and file:line.

### Named Rules

**The Three Voices Rule.** Mona Sans displays and labels; the system UI stack explains; monospace proves. Never set code in the sans, never set body copy in Mona Sans.

**The Narrow Black Rule.** Monumental type is Mona Sans 900 at width 75%, uppercase, line-height under 0.9. Don't use a lighter or wider cut for displays.

## Layout

The page is a ruled sheet. A 7fr / 5fr asymmetric split recurs everywhere: hero field and trail, section head (display left, prose right, aligned to the bottom), CLI grid, closing install, plugin split. Side gutters are `spacing.gutter`; sections breathe with `spacing.section` vertical padding and a mist rule beneath each. Definition lists and release notes use a 4fr / 8fr split. Two-up specimen and command panels sit between 1.5px Ink rules top and bottom, divided by a mist hairline.

The hero fills the first viewport (up to 62rem): the question, presets and lede on the left; the trail on the right behind a hairline, its foot pinned to the bottom with tabular numbers.

At 960px every split collapses to one column and the hero reorders to question, trail, then lede and install, each separated by hairlines. At 640px the nav wraps under the logo, tabs stack full-width, inline code breaks anywhere, and copy buttons keep only their icon.

## Elevation & Depth

Flat. There are no drop shadows anywhere. Depth is conveyed by line weight and fill: 1px mist hairlines for division, 1.5px Ink frames for panels that hold an action or evidence (install panel, viewer, CLI command, video clip, specimen and process rules), fog fills for quiet sub-areas, and the single Ink band for the one inverted moment. `box-shadow` appears only as an inset underscore for state (yellow under current nav, selected tab, hovered release version).

### Named Rules

**The Line Weight Rule.** Hairline (1px mist) divides; frame (1.5px Ink) holds. No third weight, no shadows.

## Shapes

Square. Buttons, presets, tabs, panels, tiles, badges and the video frame all have 0 radius. Only two small exceptions are rounded: inline code chips and keycaps (3px), and the trail step pills (0.32rem on a 0.64 x 1rem pill, echoing the Two Steps logo). The trail is one vertical 1px Ink rule threading those pills. Inferred relationships use a dashed rain line; proven ones a solid 1.5px Ink line.

## Components

### Buttons

Solid, square and tracked; the type itself is the hover.

- **Shape:** square corners (0), 1.5px border, 3rem tall.
- **Primary:** Ink fill, Paper label in tracked capitals, 0 1.5rem padding.
- **Hover / Focus:** tracking opens from 0.16em to 0.22em and the face widens from 100% to 112% over 0.35s on the expo-out curve; focus is a 2px Ink outline at 3px offset (yellow on the Ink band). Reduced motion removes the transition.
- **Ghost:** transparent with an Ink border and Ink label; on the band, Paper border and label.
- **Lit:** Waymark Yellow fill and border with Ink label, used on the Ink band.
- **Copy:** small square button, mist border on Paper, icon plus tracked "Copy"; Ink border on hover; turns yellow when copied.

### Chips

- **Question presets:** square, mist border, system UI 500 at 0.9rem; Ink border on hover; pressed preset inverts to Ink fill with Paper text.
- **Term tiles:** monospace search terms on a yellow tile; related terms in Graphite; set-aside words struck through in Graphite with a rain line.

### Cards / Containers

- **Corner Style:** square.
- **Background:** Paper; Fog for quiet sub-rows and code; Ink for the band.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1.5px Ink frame for the install panel and other action/evidence panels; internal rows divided by mist hairlines.
- **Internal Padding:** 1rem horizontal, 0.85rem vertical heads.

### Navigation

Ruled header, logo lockup left (30px tall), links right in tracked capitals (650, 0.75rem, 0.14em) in Graphite. Hover and current go to Ink; current also carries a 2px yellow underscore. Wraps beneath the logo at 640px. Tabs follow the same logic: Graphite at rest, Ink selected with a 3px yellow underscore.

### Command rows

A monospace command filling the row with a copy button at the end, rows divided by hairlines, scrolling horizontally without a scrollbar on wide screens and wrapping on narrow ones.

### The Storm (signature)

The editable question is a transparent textarea over the storm layer. On load or on a new question, LogicTrail's own query-term code decides each word: set-aside words split into letters that lift, scatter on the wind and settle back in Rain grey; search terms condense and a yellow tile scales in behind them from the left (0.7s, expo-out). The trail is then carved: the vertical rule grows top-down (0.9s) and steps rise in with a 70ms stagger. It happens once per viewport; reduced motion shows the settled state directly.

### The Trail

Steps of real sample flows: a pill (yellow for the first, Ink-filled for hits, hollow otherwise), a monospace label with matched fragments in `<mark>` yellow, the step type in tracked capitals, and file:line in Graphite monospace beneath.

## Do's and Don'ts

### Do:

- **Do** pair every yellow with Ink: a tile behind Ink text, an underscore beneath Ink text, or text on the Ink band.
- **Do** give the first item of any sequence the yellow tile and leave the rest Ink.
- **Do** set displays in Mona Sans 900 at width 75%, uppercase, line-height 0.88-0.9.
- **Do** put every command, identifier and file:line in the monospace stack, and cite file and line wherever a code step appears.
- **Do** divide with 1px mist hairlines and hold with 1.5px Ink frames.
- **Do** keep exactly one Ink band per page, switching its hairlines to Ink Rule and its secondary text to On-Ink Secondary.
- **Do** let motion run once and settle; ship the settled state for reduced motion.

### Don't:

- **Don't** set yellow as text, or as a fill with nothing Ink on it, on a light ground.
- **Don't** use Rain grey for small text; small secondary text is Graphite.
- **Don't** add drop shadows or rounded corners to buttons, panels or cards.
- **Don't** set body copy in Mona Sans or code in a sans.
- **Don't** typeset "LogicTrail" beside the symbol; use the lockup files.
- **Don't** build a dark terminal-mock hero over a three-up feature grid.
