---
name: viz
description: Render an ad-hoc HTML/CSS/JS visualization — charts, graphs, 3D scenes, state machines, dashboards, animated explainers, custom UIs, anything HTML+JS can express. With Bun on the host it serves at a live, hot-reloading URL with per-viz git history and an optional Bun `api.ts` backend; without a shell (chat apps, sandboxes) it writes one self-contained HTML file instead. Use when the user asks to visualize, draw, diagram, render, or "show" something richer than a static inline SVG or a tldraw canvas.
license: MIT
compatibility: Two modes. Full mode needs Bun (bun.sh) plus a shell and a browser on the same machine — pure Bun, no shell utils, so macOS/Linux/Windows. Lite mode needs nothing and runs anywhere the skill loads, including chat-app sandboxes.
metadata:
  author: RascalTwo
  source: https://github.com/RascalTwo/ai-setup
---

# /viz — ad-hoc HTML visualizations

Renders arbitrary HTML/CSS/JS as a visualization the user can open and interact with.

**Everything in this file applies in both modes** — what makes a viz good doesn't depend on
what's installed. Read it, then follow the one branch the mode check sends you to.

## Mode — resolve this first, before anything else

Two modes, and you do **not** get to pick by preference. Work down this table and take the
first row that matches:

| Test | Mode |
|---|---|
| You have **no** ability to run shell commands at all | **Lite** — go, don't ask |
| No shell, but `viz_*` MCP tools are available to you | **Full**, driven through those tools |
| `bun --version` succeeds | **Full** |
| `bun --version` fails, but you *can* run commands | **Ask the user** (below) |

The last row is a choice, not a failure — say something like:

> "No Bun on this machine. I can install it (one command from [bun.sh](https://bun.sh)) and
> give you the full thing — live hot-reloading URL, live data, publishing — or I can do this
> in lite mode right now: one self-contained HTML file, nothing installed. Which?"

Wait for the answer. Installing Bun runs a network install script on their machine; that is
never silent. Lite on a capable machine is a legitimate choice for a quick one-off, not a
booby prize.

**One more full-mode trap.** Full mode serves at `127.0.0.1:5180` and the user opens that in
*their* browser — so the server and the browser must be the same machine. If you're on a
remote box (`$SSH_CONNECTION` is set, or there's no `open`/`xdg-open`), the URL will be
unreachable no matter how well the server starts. Say so and offer lite instead.

**Then, after reading the rest of this file:** full mode → `reference/full.md`. Lite mode →
`reference/lite.md`. Those are not optional appendices — they are the other half of the
instructions, and you cannot produce a viz without reading yours.

## Ambition — this skill runs at maximum

A viz is expressive work, not production code. If a minimalism rule is active in this session — a ponytail-style "simplest thing that works", a global "be concise", a standing YAGNI default — it governs the viz's **code**: reuse the kit, don't add a framework, don't hand-roll what `viz.js` already exports. It does **not** govern the viz's **ambition**. Richness of encoding, number of altitudes, and interaction depth *are* the deliverable, not overhead on top of it. "Boring over clever" is a code rule here; it is never a design rule.

Default target is the top of the visual scale, not the floor. "Be creative" is too vague to act on, so the bar is written as five things you can **count in your own output** before calling a viz done:

| # | The bar | How to check it |
|---|---|---|
| 1 | **Meaning lives in space, not sentences.** Position, length, angle, area, or colour encodes at least one real variable. | Point at any mark and say what its x, y, size, or colour *means*. If the only answer is "a box with words in it", you built a document. |
| 2 | **The reader drives something.** A stepper, hover detail, filter, toggle, drag, or scroll-linked change. | Name the input and name what it changes. Scrolling alone doesn't count. |
| 3 | **More than one altitude, when the subject has more than one.** Overview → mechanism → detail. | If you can describe the subject at two zoom levels, the viz shows both — tabs, drill-down, or stacked sections. |
| 4 | **Every meaningful mark is identifiable.** `data-viz-id` plus a human `data-label` on bars, nodes, packets, states. | Pick a mark at random; you can name it without reading the source. |
| 5 | **The reader is smart but has zero context.** Legend, units, and a one-line "what am I looking at" are on the page. | Nothing on the page requires knowing what you already know. |

Miss one and you are not done — you are at the fallback. The styled page of cards and paragraphs is a *documented* fallback (see **Fallback hierarchy** under *Pick the visual form* below), not a starting point: taking it is a decision you announce in one line so the user can veto it.

`verify.ts` measures a **visual density** proxy for bars 1 and 5 on every run and prints it. It is informational — it never blocks a commit — because the right ratio for a deck and for a force graph are wildly different and only you can see which one you are building. Use it as a mirror, not a gate.

**Dial down only when asked.** "Quick one", "just a chart", or `--quick` on bootstrap lowers the bar for that viz. Nothing else does — not a tight budget, not a simple-looking subject, not your own read that the content is "just a list".

## Pick the visual form before writing

Visualization means encoding meaning in 2D or 3D space — position, size, color, shape, lines, arrows — not styling text in colored boxes. Before opening your editor:

1. Name the spatial form that fits the content (see menu below).
2. Announce your choice to the user in one short sentence — e.g. *"Rendering this as a force-directed graph, edges weighted by call count."* Don't wait for approval; this is a checkpoint the user can interrupt, not a question.
3. Then write.

Content → form:

- **Magnitudes / distributions / time series** → bar, line, area, histogram, sparkline grid
- **Part-to-whole** → treemap, sunburst, stacked bar, donut
- **Two+ variables** → scatter, bubble, heatmap, parallel coordinates
- **Hierarchy** → tree, dendrogram, icicle, treemap
- **Relationships / dependencies / networks** → force-directed graph, arc diagram, adjacency matrix, chord, Sankey
- **Sequence / flow / process / state** → flowchart, sequence diagram, state machine, swimlane
- **Architecture / topology** → laid-out boxes-and-arrows, layered or deployment diagrams
- **Comparison across categories** → grouped bars, radar, slope chart, dot plot — a styled comparison table is the fallback, not the default
- **Spatial / geographic** → map, floor plan, schematic
- **3D structures, scenes, physical systems** → three.js / WebGL
- **Explanatory** → animated transitions, scroll-driven steps, interactive walkthroughs
- **Narrated over time** (a film with a duration, wanted as video) → timed film — needs the seek contract in `reference/timeline.md` before you write a line of it

Hand-rolled SVG (`<rect>`, `<line>`, `<path>`, `<text>`) is often the cleanest answer. Reach for D3 for layout math, three.js for 3D, Canvas for high element counts.

**If you just picked a boxes-and-arrows form** — flowchart, state machine, swimlane, sequence, architecture, topology — read `reference/diagrams.md` now, before writing coordinates.

**If the form is a chart** (the first four lines above) and a `dataviz` skill exists, read it before writing chart code — this skill owns the plumbing, `dataviz` owns the mark/axis/legend/tooltip craft. Take its rules, but keep rendering through kit tokens; don't import its palette on top of ours.

**Fallback hierarchy.** A real spatial form > a styled page > terminal text. A styled page (cards, colored tables, typographic hierarchy) is acceptable when no spatial encoding genuinely fits — it's the bottom of the barrel, not banned, and still beats text in a terminal. Dropping to it is a decision you **announce in one line** (per **Ambition**) so the user can veto it, never a default you drift into. But if the content has magnitudes, relationships, sequences, hierarchy, or topology, there's a real form for it — find that first. Never exit saying "this isn't visualizable"; if all else fails, ship the styled page.

**Exception:** if the user asked to design a UI or screen, the UI itself is the visual artifact.

## Start from the viz kit

A shared kit is served at `/_kit/` (from the skill's own `kit/` dir). It exists because nearly every past viz re-derived the same dark palette, re-guessed the same hexes, and reinvented the same components and SVG math. Load it so you don't repeat that:

```html
<link rel="stylesheet" href="/_kit/viz-kit.css">
<script type="module">
  import {
    arrowMarkers, connect, center, side, labelBox, vizAudit,   // SVG diagrams
    stepper, twoAxis, figureLifecycle,                          // interaction
    $, $$, esc, saveHash, loadHash,                             // utilities
  } from "/_kit/viz.js";
  // ...your code
</script>
```

**Read that list before you hand-roll.** If a name above sounds like what you're about to write, it is — helpers absent from this snippet get re-implemented across dozens of vizzes, each getting a different subset of the edge cases right.

- **Colors** — reach for `var(--accent)`, `var(--good)`, `var(--warn)`, `var(--danger)`, and the `--c1`…`--c8` categorical ramp instead of picking new hexes. The default house style is dark GitHub-ish.
- **Need a different palette? Re-theme it — don't abandon the kit.** Every color in `viz-kit.css` lives in one `:root` block and every rule reads it through `var()`, so a later `:root` in your page re-skins *everything* while you keep `.panel`, `.legend`, `.drawer`, `.flow`, `labelBox()` and the rest. A branded or moody viz is a 6-line override, not a from-scratch rebuild:
  ```html
  <link rel="stylesheet" href="/_kit/viz-kit.css">
  <style>:root { --bg:#081428; --panel:#0e1c33; --accent:#37d9a0; --text:#e8f0ff; }</style>
  ```
- **`var()` works in SVG presentation attributes** — `fill="var(--accent)"` and `stroke="var(--c4)"` are valid. Use them instead of hardcoding hexes, or your marks won't follow a re-theme.
- **Chrome** — `.viz-header` (title + `.sub`), `.panel`/`.card`, `.legend`/`.swatch`, `.drawer` (toggle `.open`), `.flow` (animated dashed edge) are ready-made.
- **Override the property, don't restate the rule.** To tweak a kit component, set only what differs (`.legend { margin-top: 18px }`). Re-declaring the whole block is how a kit component silently becomes a fork: the kit's values get retyped, then stop tracking the kit when it improves. Corpus-wide, more than half of all kit-component overrides restate 6+ properties to change one.
- **State across reloads** — persist anything that should survive a save (open panel, selected step, filters) with `saveHash()`/`loadHash()`; that also makes the view deep-linkable.
- **Make it an explorable, not a picture** — `stepper()` (arrow-key walkthrough), `twoAxis()` (drag the artwork, not a slider), `figureLifecycle()` (pause off-screen figures, spotlight the centered one). Details in `/_kit/README.md`.
- **Anything animated must be steppable.** Play/pause alone is a demo, not an explainer — the reader can't stop to read the thing you wrote for them. Ship play/pause, step forward *and* back, a visible position (`3 / 9`), and arrow keys. `stepper()` gives you this; a timed film exposing `goTo(t)` gets it for free. An animation that only plays is bar 2 unmet.
- **Motion is guarded for you** — the kit honours `prefers-reduced-motion` for CSS. A JS rAF loop is yours: gate on `matchMedia("(prefers-reduced-motion: reduce)").matches` and jump to the end state. If the viz is a timed film, don't write this twice — the seek contract in `reference/timeline.md` makes reduced-motion the same code path as seeking.

Full token + helper list: `/_kit/README.md` (or `kit/README.md` in the skill). The kit is opt-in and additive — skip it if a viz genuinely needs something else — but default to it.

## If you're drawing boxes and arrows

**Stop and read `reference/diagrams.md` before you place a single coordinate.** Diagrams are where past vizzes bled the most iteration — labels overflowing, arrows pointing at empty space, whole layouts redone late — and the root cause was always the same: coordinates typed as independent literals, then guessed wrong. The file is short and it's all avoidance, not repair: derive geometry from one `{x, y, w, h}` per node, `labelBox()` so text can't spill, `arrowMarkers()` per color, elkjs past ~5 nodes, and the silent `w`/`h`-aren't-SVG-attributes trap.

## Now follow your mode

You have the bar, the form, the kit and the diagram rules. The mechanics differ:

- **Full mode** → read **`reference/full.md`** now. Paths, creating a viz, the server, git,
  verifying, publishing, backends, the review layer.

  The toolchain is one command — `viz <verb>` — and **every flag it takes is documented by
  `viz <verb> --help`**, generated from the same declaration the parser uses. Ask the CLI
  rather than trusting a flag you remember; the docs deliberately stop restating them, so
  a flag written down somewhere and a flag that exists are not the same thing.
  `viz <verb> --examples` adds worked examples where a verb has them.
- **Lite mode** → read **`reference/lite.md`** now. How to inline the kit and hand the user
  one self-contained file.

Read it before you write anything. Do not improvise the half you haven't read.

## When NOT to use this skill

- A single static SVG fits inline in the chat — just write it inline.
- The user wants shapes/text/arrows on a freeform canvas — `tldraw-canvas` is built for that.
- The visualization is text/ASCII — render in the terminal.
- The user is iterating on real production UI — don't pollute the viz data dir (`$VIZ`); work in their actual project.
