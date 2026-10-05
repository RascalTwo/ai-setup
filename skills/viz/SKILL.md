---
name: viz
description: "Renders an ad-hoc HTML/CSS/JS visualization (charts, 3D, state machines, dashboards, animated explainers, slide decks, custom UIs) as a live local URL or one self-contained HTML file. Use to visualize, diagram, or \"show\" something richer than static SVG or tldraw, or to find or share an existing viz."
license: MIT
compatibility: Two modes. Full mode needs Bun (bun.sh) plus a shell and a browser on the same machine — pure Bun, no shell utils, so macOS/Linux/Windows. Fallback mode needs nothing and runs anywhere the skill loads, including chat-app sandboxes.
metadata:
  author: RascalTwo
  source: https://github.com/RascalTwo/ai-setup
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    git: per-viz history in the page library
  requires: [bun]
---

# /viz — ad-hoc HTML visualizations

Renders arbitrary HTML/CSS/JS as a visualization the user can open and interact with.

**Everything in this file applies in both modes** — what makes a viz good doesn't depend on
what's installed. Resolve the mode, read the rest of this file, then read the mode doc it
ends by sending you to.

## Mode — resolve this first, before anything else

Two modes, and you do **not** get to pick by preference. Work down this table and take the
first row that matches:

| Test | Mode |
|---|---|
| You have **no** ability to run shell commands at all | **Fallback** — go, don't ask |
| No shell, but `viz_*` MCP tools are available to you | **Full**, driven through those tools |
| `bun --version` succeeds | **Full** |
| `bun --version` fails, but you *can* run commands | **Ask the user** (below) |

The last row is a choice, not a failure — say something like:

> "No Bun on this machine. I can install it (one command from [bun.sh](https://bun.sh)) and
> give you the full thing — live hot-reloading URL, live data, publishing — or I can do this
> in fallback mode right now: one self-contained HTML file, nothing installed. Which?"

Wait for the answer. Installing Bun runs a network install script on their machine; that is
never silent. Fallback on a capable machine is a legitimate choice for a quick one-off, not a
booby prize.

**One more full-mode trap.** Full mode serves at `127.0.0.1:5180` and the user opens that in
*their* browser — so the server and the browser must be the same machine. If you're on a
remote box (`$SSH_CONNECTION` is set, or there's no `open`/`xdg-open`), the URL will be
unreachable no matter how well the server starts. Say so and offer fallback instead.

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

Miss one and you are not done — you are at the styled-page fallback (**Fallback hierarchy**, below), which is a decision you announce, not a starting point.

In full mode `viz verify` prints a **visual density** proxy for bars 1 and 5. It never blocks: a deck and a force graph have opposite right answers, and only you can see which you are building. A mirror, not a gate.

**Dial down only when asked.** "Quick one", "just a chart", or `--quick` on `viz create` lowers the bar for that viz. Nothing else does — not a tight budget, not a simple-looking subject, not your own read that the content is "just a list".

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
- **Narrated over time** (a film with a duration, wanted as video) → timed film — needs the seek contract in `reference/timeline.md` before you write a line of it; `viz render` turns it into an mp4, with narration and captions from `narration.json`

Hand-rolled SVG (`<rect>`, `<line>`, `<path>`, `<text>`) is often the cleanest answer. Reach for D3 for layout math, three.js for 3D (in a film: `reference/3d.md`), Canvas for high element counts. What else is reachable with no install — webfonts, vendor logos, syntax highlighting, and the few libraries that have earned their place — is in `reference/cdn.md`.

**Hand-drawn art layer:** when the `anidoodle` skill is installed and a part of the viz would gain from being drawn by hand or a strongly illustrated style, invoke anidoodle for that piece.

**If you just picked a boxes-and-arrows form** — flowchart, state machine, swimlane, sequence, architecture, topology — **read `reference/diagrams.md` before you place a single coordinate.** Diagrams are where past vizzes bled the most rework, always from coordinates typed as independent literals and guessed wrong.

**If the form is a chart** (the first four lines above) and a `dataviz` skill exists, read it before writing chart code — this skill owns the plumbing, `dataviz` owns the mark/axis/legend/tooltip craft. Take its rules, but keep rendering through kit tokens; don't import its palette on top of ours.

**Fallback hierarchy.** A real spatial form > a styled page > terminal text. A styled page (cards, colored tables, typographic hierarchy) is acceptable when no spatial encoding genuinely fits — it's the bottom of the barrel, not banned, and still beats text in a terminal. Dropping to it is a decision you **announce in one line** so the user can veto it, never a default you drift into. But if the content has magnitudes, relationships, sequences, hierarchy, or topology, there's a real form for it — find that first. Never exit saying "this isn't visualizable"; if all else fails, ship the styled page.

**Exception:** if the user asked to design a UI or screen, the UI itself is the visual artifact.

## Check for a template before you create

A deck, a share card, an exchange, or a brand variant someone built is a **template**: a finished starting page. **Before `viz create`, run `viz templates <kind>`** — none fits → the blank starter and the kit; one fits → offer it; **more than one fits → ask the user which**, never pick silently. Using, making or editing one: `reference/templates.md`; building an exchange: `kit/EXCHANGE.md`.

## Start from the viz kit

A shared kit is served at `/_kit/` (from the skill's own `kit/` dir). It exists because nearly every past viz re-derived the same dark palette, re-guessed the same hexes, and reinvented the same components and SVG math. Load it so you don't repeat that:

```html
<link rel="stylesheet" href="/_kit/viz-kit.css">
<script type="module" src="./app.js"></script>   <!-- app.ts; fallback mode: plain JS (reference/typescript.md) -->
```

```ts
// app.ts
import {
  arrowMarkers, connect, center, side, labelBox, vizAudit,   // SVG diagrams
  stepper, twoAxis, figureLifecycle, narrate,                 // interaction, film audio
  $, $$, esc, saveHash, loadHash,                             // utilities
} from "@viz/kit";
// ...your code
```

`@viz/kit` is `viz.js`; any other kit file is `@viz/kit/<file>.js` (`zod.js`, `api.js`, `film.js`, …), in a page and in an `api.ts` alike. The server puts the import map in your page; export and publish inline it. Never write `/_kit/…` in an import: lint flags it and `viz lint --fix` rewrites it. Only the `<link>` above (and a `<script src>`) keep the `/_kit/` path, since an import map does not apply to them.

Your own files import downward only: `./x.js` or `./sub/x.js`, never `../x.js` (lint flags it; `tests/` may). Code that several files share goes in a subfolder they import from. A deliberate exception takes `/* oxlint-disable import/no-relative-parent-imports -- why */`.

**Read that list before you hand-roll.** If a name above sounds like what you're about to write, it is — each re-implementation gets a different subset of the edge cases right.

**Need a different palette? Re-theme the kit — don't abandon it.** Every colour is a token (`var(--accent)`, `--good`, `--warn`, `--danger`, the `--c1`…`--c8` ramp), so a later `:root` override re-skins every component while you keep them. The snippet, every token and helper, and the rules for overriding a component: `kit/README.md` — read it before you pick a hex or restyle a kit class.

**Anything animated must be steppable.** Play/pause alone is a demo, not an explainer — the reader can't stop to read the thing you wrote for them. Ship play/pause, step forward *and* back, a visible position (`3 / 9`), and arrow keys; `stepper()` gives you all of it. A JS rAF loop must also honour `prefers-reduced-motion` (the kit's CSS already does) — or, for a timed film, get it free from the seek contract.

## Hand it over the moment it renders something real

Say in one line what it shows, what they can drive, and that you're still working. Then keep
going — don't save the reveal for the end of your turn.

## Now follow your mode

The mechanics differ by mode, and your mode doc is the other half of the instructions —
read it before you write anything:

- **Full mode** → **`reference/full.md`**: paths, create, write, hand off, verify, commit —
  and where to go for publishing, managing the library, backends and the feedback widget.
  The toolchain is one command, `viz <verb>`, and **every flag it takes is documented by
  `viz <verb> --help`**, generated from the same declaration the parser uses. The docs
  deliberately don't restate flags — ask the CLI rather than trusting one you remember.
  `viz <verb> --examples` adds worked examples where a verb has them.
- **Fallback mode** → **`reference/fallback.md`**: inline the kit and hand the user one
  self-contained file.

## Reference files — read the one your step calls for

- `reference/verify.md` — reading a verify report; `reference/verify-states.md` — a viz with more than one state
- `reference/testing.md` — tests for a viz that computes what it shows
- `reference/backend.md` — live data (`api.ts`), streaming, the tape recorder
- `reference/publishing.md` — publishing to a static host; `reference/publishing-advanced.md` — its optional features
- `reference/manage.md` — finding and changing vizzes; `reference/ops.md` — server, discovery, system internals; `launchd/README.md` — keeping the server alive
- `reference/assets/fonts.md`, `reference/assets/logos-icons.md`, `reference/assets/code-highlighting.md` — webfonts, vendor logos, syntax highlighting
- `reference/review-layer.md` — the feedback widget
- `kit/CANDIDATES.md` — patterns that might be promoted into the kit

## Skills built on this one

A new skill that depends on viz carries `viz` in its name (`grill-me-viz`, `pr-viz`), so the
dependency shows in every skill list.

## When NOT to use this skill

- A single static SVG fits inline in the chat — just write it inline.
- The user wants shapes/text/arrows on a freeform canvas — `tldraw-canvas` is built for that.
- The visualization is text/ASCII — render in the terminal.
- The user is iterating on real production UI — don't pollute the viz data dir (`$VIZ`); work in their actual project.
