---
name: viz
description: Render an ad-hoc HTML/CSS/JS visualization — charts, graphs, 3D scenes, state machines, dashboards, animated explainers, custom UIs, anything HTML+JS can express — and serve it at a live, hot-reloading URL, optionally backed by a Bun `api.ts` for live data. All viz pages are git-tracked for rollback. Use when the user asks to visualize, draw, diagram, render, or "show" something richer than a static inline SVG or a tldraw canvas.
license: MIT
compatibility: Requires Bun (bun.sh). Pure Bun, no shell utils — runs on macOS/Linux/Windows.
metadata:
  author: RascalTwo
  source: https://github.com/RascalTwo/ai-setup
---

# /viz — ad-hoc HTML visualizations

Renders arbitrary HTML/CSS/JS as a live, browser-served visualization with hot-reload, optional per-page Bun backend, and per-viz git history.

Architecture: a singleton Bun server at `127.0.0.1:5180` serves vizzes from **many roots**, not one. There's the central library (`$VIZ`, resolved below — one git repo), plus **repo-local vizzes**: any `viz-pages/` folder living inside one of your own repos. The server is lazy-spawned by the bootstrap script and persists across sessions.

A viz is identified by **its path relative to your home directory**, which is also its URL — e.g. central `~/.claude/viz-pages/foo` serves at `/.claude/viz-pages/foo/`, and repo-local `~/Code/app/viz-pages/bar` serves at `/Code/app/viz-pages/bar/`. Real filesystem paths are globally unique, so two repos can both have a `dashboard` viz and never collide.

Repo-local vizzes are auto-discovered on server start (or via Rescan); creating one registers it immediately. Mechanics in `reference/ops.md`.

Bun is the only prerequisite (pure Bun, no shell utils → runs on macOS/Linux/Windows; install from [bun.sh](https://bun.sh) if `bun --version` fails). Nothing is hardcoded to a specific agent or install path — resolve the two paths below instead of assuming locations.

## Paths — resolve these, never hardcode

Set these once at the start of a viz task and reuse them. Do **not** assume `~/.claude/...`.

**`$SKILL_DIR` — where this skill's code lives.** It's the directory containing *this* `SKILL.md`, alongside `bootstrap.ts` and `server.ts`. Prefer the directory your agent loaded this skill from; otherwise:

```bash
SKILL_DIR="${VIZ_SKILL_DIR:-$HOME/.claude/skills/viz}"
```

That's a direct path, not a search — it resolves instantly. Set `VIZ_SKILL_DIR` if the skill lives elsewhere. Only if that path doesn't exist, fall back to a search: `SKILL_DIR=$(dirname "$(find ~ -path '*/skills/viz/bootstrap.ts' 2>/dev/null | head -1)")` — but note it scans your whole home dir (~14s) and **resolves symlinks**, so it can hand back a different path than the one you loaded the skill from. Use the fallback only when the direct path fails.

**`$VIZ` — where viz pages and the git repo live.** `bootstrap.ts` and `server.ts` resolve this internally, so you don't need it just to run them. For the ops/git commands below, resolve it the same way they do:

```bash
VIZ="${VIZ_PAGES_DIR:-$([ -d ~/.viz-pages ] && echo ~/.viz-pages || echo ~/.claude/viz-pages)}"
```

Resolution order is `$VIZ_PAGES_DIR` → `~/.viz-pages` (neutral default) → `~/.claude/viz-pages` (legacy, kept so pre-existing libraries still load). Set `VIZ_PAGES_DIR` to relocate.

## Step 1: Bootstrap

Argument: `/viz [name] [--local [dir]] [--global] [--deck] [--poster]` — optional human-readable slug (e.g. `import-graph`, `bar-chart-population`). If absent, pick one based on what's being visualized. Use kebab-case.

Two scaffolds replace the blank starter when the viz has a known shape. Both compose with `--local`/`--global`, and both carry an authoring-guide comment in the file:

- **`--deck`** — an arrow-key presentation deck: scale-to-fit 16:9 canvas, `←/→/space` + `F` fullscreen, progress bar, `.reveal` cascades, and reversible per-slide fragments (`.frag`). Add slides by copying a `<section class="slide">`.
- **`--poster`** — a viz that *is* its own OG card: a fixed **1200×630** `.og-card` stamped `viz:card=self`, so `verify.ts --og` clips it straight to `og.auto.png` with no separate `hero.html`. Keep key content in the centre ~1080×565 safe zone (`class="show-safe"` toggles a guide).
- **`--hero`** — adds a starter `hero.html` beside `index.html`: the 1200×630 card that unfurls when the viz URL is shared, while the viz itself stays a normal page. Built on `/_kit/viz-og.css`, so it re-themes with the viz. Use this when the viz needs a card *different* from itself; `--poster` is for when the whole page **is** the card (the two don't combine).

Why 1200×630 specifically, and the rest of the card pipeline: `reference/publishing.md`.

**Check what already exists first.** There are 100+ vizzes across your repos, and the fastest way to a good one is usually forking a good one — the SVG scaffolding, the layout, the interaction wiring are all already solved somewhere:

```bash
bun "$SKILL_DIR/manage.ts" search sankey        # matches path/title/tags AND page source
bun "$SKILL_DIR/manage.ts" ls --posture=public  # or just list them, newest first
bun "$SKILL_DIR/bootstrap.ts" <new-slug> --from <viz-folder>   # fork one
```

`search` reads the page source, not just metadata, so it finds the viz that *drew* a Sankey even if its title never says so. A fork copies everything but **always resets to `local`/`unlisted`** — posture is a trust decision and is never inherited — and drops the source's `comments.json`, `og.auto.png` and `recordings.json`.

**Central (default).** With no flag, the viz is created in the central library and committed to its git repo — the normal, throwaway scratch space:

```bash
bun "$SKILL_DIR/bootstrap.ts" <slug>
```

The script scaffolds `$VIZ/<slug>/index.html` (pre-stamped with the safe-default `viz:posture=local` + `viz:listed=unlisted` metas — invisible until you open it up, see Step 4), spawns the server if needed, commits with a `Session:` trailer, and prints the URL + session ID. It **fails loud** if the slug already exists (pick another, e.g. `-v2`) or if port 5180 is taken by something else.

Capture the printed `Session: <id>` — you'll reuse it as the trailer on every subsequent commit for this central viz.

**Repo-local (`--local`).** Use this when the viz belongs *with* a project — it visualizes that repo's architecture/data and should be versioned alongside its code:

```bash
bun "$SKILL_DIR/bootstrap.ts" <slug> --local            # in the cwd's git repo
bun "$SKILL_DIR/bootstrap.ts" <slug> --local <dir>       # in an explicit dir
```

In local mode the script creates `<repo-root>/viz-pages/<slug>/` (repo root via `git rev-parse --show-toplevel`; or `<dir>/viz-pages/<slug>/` when a dir is given), registers it in `$VIZ/.discovered.json` so it's discoverable immediately, and **does not touch git** — it prints a `git add` hint instead. The viz is committed in the **host repo**, by you, with that project's normal conventions (no `Session:` trailer). The viz dir must live under your home directory (that's where discovery looks). `--global` forces central even when run inside a repo.

`--local` also vendors a self-contained runtime into `<repo>/viz-pages/.runtime/`, so the repo's vizzes stay **independently runnable with no skill installed** (`bun viz-pages/.runtime/server.ts`). It's regenerated on every `--local` run — never hand-edit it. Details in `reference/ops.md`.

If the script errors, surface the error verbatim. Don't try to recover by picking a different slug unless the user agrees.

## Step 2: Write the visualization

> **Bootstrap already created `index.html`** (pre-stamped with posture metas) **and printed it to stdout** — so you can `Edit` it straight away without reading it back. Keep the `viz:*` meta lines; edit everything else freely. (`--deck` is the exception: its template is large, so it isn't dumped — read that one.)

### Pick the visual form before writing

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

Hand-rolled SVG (`<rect>`, `<line>`, `<path>`, `<text>`) is often the cleanest answer. Reach for D3 for layout math, three.js for 3D, Canvas for high element counts.

**If the form is a chart** (the first four lines above) and a `dataviz` skill exists, read it before writing chart code — this skill owns the plumbing, `dataviz` owns the mark/axis/legend/tooltip craft. Take its rules, but keep rendering through kit tokens; don't import its palette on top of ours.

**Fallback hierarchy.** A real spatial form > a styled page > terminal text. A styled page (cards, colored tables, typographic hierarchy) is acceptable when no spatial encoding genuinely fits — it's the bottom of the barrel, not banned, and still beats text in a terminal. But if the content has magnitudes, relationships, sequences, hierarchy, or topology, there's a real form for it — find that first. Never exit saying "this isn't visualizable"; if all else fails, ship the styled page.

**Exception:** if the user asked to design a UI or screen, the UI itself is the visual artifact.

### Start from the viz kit

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
- **Motion is guarded for you** — the kit honours `prefers-reduced-motion` for CSS. A JS rAF loop is yours: gate on `matchMedia("(prefers-reduced-motion: reduce)").matches` and jump to the end state.

Full token + helper list: `/_kit/README.md` (or `kit/README.md` in the skill). The kit is opt-in and additive — skip it if a viz genuinely needs something else — but default to it.

### Drawing SVG diagrams without the usual rework

Boxes-and-arrows diagrams are where past vizzes bled the most iteration — labels overflowing their boxes, arrows pointing at empty space or the wrong box, whole diagrams re-laid-out late. The root cause was always the same: coordinates typed as independent literals, then guessed wrong. Avoid it structurally rather than fixing it after the fact:

- **Define each node once** as `{x, y, w, h}`, then compute every arrow endpoint and label position *from* that geometry (`connect(a, b)`, `side(node, "right")`) — never as a separate literal. Now moving or resizing a box can't strand its arrows.
- **Budget the layout up front** — decide the container width and column positions before placing anything, so the Nth element doesn't blow past the edge and force a redo of the whole row.
- **Labels: use `labelBox(node, html)`** (a `<foreignObject>`) for anything multi-word — the browser wraps and ellipsizes, so text *cannot* spill. Raw `<text>` has no overflow protection; you'd be back to measuring widths by hand (which is exactly what kept going wrong).
- **Arrowheads: `arrowMarkers()`** emits stable-id markers once; reference `marker-end="url(#ah-accent)"`. SVG markers can't inherit a line's color, so you need one per color — the helper handles that instead of you copy-pasting a `<marker>` block per hue.
- **More than ~5 nodes with crossing edges** — stop hand-placing and use a layout engine. Reach for **[elkjs](https://github.com/kieler/elkjs)** (`https://esm.sh/elkjs`): you hand it nodes + edges, it hands back coordinates, and **you still draw the SVG yourself** in your own styling — it replaces the coordinate math, not the craft. Manual placement past ~5 nodes is where the rework lives. (Avoid `dagre` — unmaintained, last release 2019.) Mermaid is fine for a throwaway diagram, but its default look is generic; don't reach for it when the diagram is the deliverable.
- **If you do hand-roll `<text>`**, call `vizAudit()` after render: it red-outlines any label that spills its box and shows a banner, so an overflow is visible in the open browser (and in any screenshot) instead of discovered three commits later.
- **`{x, y, w, h}` is the node shape, not the SVG attribute set.** `<rect w= h=>` isn't an error — SVG ignores unknown attributes, so the box renders at zero size, invisible, clean console. It's `width`/`height`; only `x`/`y` carry over. Tell: verify's census says `rendered: 0 rect` when you drew twelve.

### Tooling

Bootstrap already left a starter `$VIZ/<slug>/index.html` carrying `viz:posture=local` + `viz:listed=unlisted` (safe on both axes). **Edit that file** (don't blind-overwrite the whole thing away) — keep those two lines, changing `posture` to `public`/`private` and `listed` to `listed` only when the user wants to publish/advertise (Step 4). Write any other files you need alongside it. The viewport is the user's browser, so be ambitious:

- Use CDN imports: `<script type="module" src="https://esm.sh/d3@7"></script>`, `https://esm.sh/three`, `https://esm.sh/react@18`, etc.
- Inline data as `<script>` blobs, or write `data.json` and `fetch("data.json")`
- Vanilla SVG/Canvas, D3, three.js, React, Vue — anything HTML+JS supports

The server auto-injects an SSE reload script into served HTML. Saves trigger a full page reload, so in-page JS state is nuked — don't rely on it surviving. Persist anything that must survive to the URL hash (`saveHash`/`loadHash` from the kit).

### If you need a backend, streaming, or a frozen tape

A viz can expose a Bun-backed `api.ts` for live data (shell commands, file reads), stream it over SSE, and record a **tape** so an api-backed viz survives away from its data source. Full details — handler shape, relative-URL rule, hot-reload caveat, secret redaction, SSE vs POST loop, live-demo fallback, and the `--record`/`--frozen` tape recorder: see `reference/backend.md`.

## Step 3: Verify, then commit after each logical change

### Verify before you commit

The viz isn't done when the code is written — it's done when it renders correctly. Past vizzes shipped layout bugs (overflowing labels, disconnected arrows) and silent JS errors (a typo'd function, a 404'd CDN import → blank page, no signal) that then took several follow-up commits to clean up, because nothing was checked before committing. **Always run the render check before committing** — don't eyeball it and hope:

```bash
bun "$SKILL_DIR/verify.ts" <url>        # url that bootstrap printed
bun "$SKILL_DIR/verify.ts" <url> --wait='.chart' --full   # wait for a selector, full-page shot
```

First use needs `bun install` in `$SKILL_DIR` (pulls puppeteer-core; it drives your already-installed Chrome — no Chromium download). Set `PUPPETEER_EXECUTABLE_PATH` if Chrome isn't at the default location.

It drives headless Chrome once and writes four files under `$SKILL_DIR/.verify/` (overwritten every run — and all `.png`s are wiped at the start of each run — so they never bloat context or go stale unless you read them):

| file | what | read it when |
|------|------|--------------|
| `latest.png` | screenshot | to judge how it **looks** — and always once before you finish |
| `console.txt` | console + uncaught errors + failed requests + the layout report | the run reports `✗ N error(s)` |
| `network.txt` | full request + response (headers + bodies) | a fetch/CDN/api call looks wrong |
| `dom.html` | final DOM after load + interactions | you need to inspect rendered structure |

**Every run also prints a layout report** — no opt-in, nothing to import:

```
✓ 0 error(s) — .verify/{console.txt, latest.png, network.txt, dom.html}
⚠ 3 layout finding(s) · rendered: 17 rect, 11 path, 40 text
  text-overflow: text.nsub "Claude Haiku 4.5 · cloud twin" spills 37px past its box
  clipped: div.vsvg-label "build/dependency-graph-data.json…" is cut off by 87px horizontally
  og-card-overflow: 1 element(s) escape the card frame — div.stat-row
```

It checks the things eyes are bad at and that caused the most historical rework: SVG
`<text>` past its own box, content silently **clipped** by an `overflow:hidden`
ancestor (a `labelBox()` truncating mid-word looks fine in a screenshot), anything
wider than the viewport, content escaping a 1200×630 `.og-card`, and a blank render.
The mark census (`rendered: 17 rect…`) instantly separates "rendered nothing" from
"rendered wrong".

**Use it to change how you iterate:** fix the named selectors from stdout — that's
free. Don't burn a screenshot read hunting for overflow; the audit already found it.
Do read `latest.png` to judge what the audit *can't* measure — spacing rhythm, visual
hierarchy, whether the thing actually reads — and read it at least once before you
call the viz done. `⚠ 0 layout finding(s)` means "nothing is broken", not "it looks good".

The stdout line says `✓ 0 error(s)` or `✗ N error(s)` with the first few inline — so:

- **If it reports errors**, read `.verify/console.txt` for the full list (uncaught exceptions, bad CDN imports, api 500s). Fix them — a viz with console errors is broken even if it looks fine.
- **Read `.verify/latest.png`** to judge the render: for an SVG diagram, confirm no label spills its box and every arrow connects the boxes you meant (`vizAudit()` red-outlines `<text>` overflows so they show in the shot). This is cheaper than driving Chrome MCP — console is text, and it's one command, not a live browser session.
- **If the viz has more than one state, verify more than one state.** Steps, tabs, drawers, hover states, an animation with a destination — a plain run only ever sees state 1, which is how nearly every interactive viz in the corpus shipped unlooked-at past its opening frame. Write one:
- **Exercise interactions + take your own shots** — to drive a click/modal/step before the shot, drop a file *in the viz dir* named `verify.interactions.ts` exporting `export default async (page, { shot }) => { ... }`. verify auto-detects and runs it (no flag) after load, before the final screenshot, then you can delete it. It's per-viz and disposable; never edit `verify.ts` itself. **You are not limited to the one `latest.png`** — `page` is the raw Puppeteer page, and `shot(name)` writes an extra `.verify/<name>.png` (path resolved for you) any time you want. Snap before *and* after a click, snap each tab, snap each step of an animation — then read those PNGs. They're wiped at the start of every run, so a shot named `before`/`after` is always from this run:
  ```ts
  export default async (page, { shot }) => {
    await shot("closed");              // → read .verify/closed.png
    await page.click(".accordion");
    await shot("open");                // → read .verify/open.png
  };
  ```
- **Backend vizzes** — also hit the route(s) directly; confirm live data flows and the cached fallback still plays. A broken `api.ts` now returns a clean `api.ts failed to load: …` 500 instead of a blank hang.

Fix what you find within the spirit of the change, then commit.

### Commit

**Repo-local vizzes** are committed in their **host repo**, not the central one — `cd` to that repo and `git add viz-pages/<slug>/` with the project's normal commit conventions (no `Session:` trailer). The rest of this section is for **central** vizzes.

Every time you finish a coherent change to a central viz (creation is already handled by bootstrap), commit:

```bash
cd "$VIZ" && git add <slug>/ && git commit -m "<slug>: <semantic message>

<optional body>

Session: <session-id>"
```

Examples of good messages:
- `import-graph: color edges by file size, switch to log scale`
- `bar-chart-population: add per-country tooltip, fix y-axis label cutoff`
- `state-machine-checkout: model retry/cancel transitions, clean up dead states`

The `Session:` trailer is required. Use the session ID that bootstrap printed (it auto-detects it). Under Claude Code it's also in the `CLAUDE_CODE_SESSION_ID` env var, so `"$CLAUDE_CODE_SESSION_ID"` works in the heredoc; under other agents, just paste the value bootstrap printed. This makes commits greppable by session: `git log --grep "Session: <id>"`.

**Or let verify do it** — `--commit` makes "verified" and "committed" the same event:

```bash
bun "$SKILL_DIR/verify.ts" <url> --commit="<slug>: <semantic message>"
```

It commits **only if the run is clean** (0 errors, 0 layout findings), so a broken render can't quietly reach the history; otherwise it prints why and exits 1. It works out which repo owns the viz — a repo-local viz is committed in its **host** repo with no `Session:` trailer, a central one gets the trailer added automatically. Fix the findings and re-run, or commit by hand if they're intentional.

If you commit manually and forget, the changes get bundled into the next commit — inconvenient but recoverable.

## Iteration

When the user asks to change the existing viz ("color the bars red", "add a legend", "make it 3D"), edit the same files in `$VIZ/<slug>/`. Browser hot-reloads, full page refresh on save. After each change, commit per Step 3.

If the user wants a *new, separate* viz alongside the existing one, run bootstrap with a fresh slug.

## Reviewing a viz — the anchored comment layer

Every live viz auto-injects a **review layer**: the user Alt/Option-clicks any element to drop a comment that anchors to it (robust selector + text + `data-*`) and renders a pin that follows the element even as the viz animates. This is how the user hands *you* located visual feedback. Comments live as a bare array in `comments.json` beside the viz's `index.html` — git-ignored, never committed.

**You resolve; you never delete. The user deletes; the user never resolves.** After editing the viz to address a comment, PATCH it to `resolved` with a one-line note on what you changed. The full lifecycle table, the read/resolve curl path, the comment JSON shape, the `data-viz-id` authoring convention, and the optional `__vizPause()` hook: see `reference/review-layer.md`.

**Authoring convention worth keeping in the spine:** stamp `data-viz-id` (and a human-readable `data-label`) on every meaningful mark (bars, packets, nodes) when you build a chart/diagram/animation — without it, a textless element's comment anchor falls back to a brittle `:nth-of-type` path.

## Step 4: Publish to a static host (optional)

When the user wants a viz reachable **over the internet** (not just localhost), publish it with `build.ts` (central-only) — it builds one self-contained HTML per viz that any static host (GitHub/GitLab Pages) serves. An api-backed viz must have a tape recorded first (see `reference/backend.md`); it ships as a frozen tape behind a snapshot banner.

```bash
bun "$SKILL_DIR/build.ts" preview <container> [--port <n>] [--open]   # see the real deployable bytes, locally
bun "$SKILL_DIR/build.ts" <container> [--out <dir>] [--base-url <url>] # build a whole container
bun "$SKILL_DIR/build.ts" rotate <vizDir>                             # revoke + re-mint a private magic link
bun "$SKILL_DIR/build.ts" rotate <container> --lobby                  # revoke + re-mint a container's LOBBY key
```

Each viz declares its own **posture** (`public`/`private`/`local`), **listing** (`listed`/`unlisted`), and **kind** (`explanatory`/`operational`) via `<meta>` tags in its `index.html` — there are no CLI flags for these. An undeclared posture makes the whole run refuse. `build.ts` writes artifacts to a `dist` dir but **never deploys** — pushing to `gh-pages` is a separate, human-confirmed step.

**Rich link previews (Open Graph):** every **public** viz unfurls a card in Slack/Discord/Webex, with text auto-built from `viz:title`/`viz:description`. The 1200×630 image is picked by filename provenance: `og.png`/`og.jpg` (human-made) → `hero.html` (a card authored in HTML — the usual answer; scaffold with `bootstrap.ts <slug> --hero`, shoot with `verify.ts --og`) → `og.auto.png` (bare live-page shot, which build warns about). No image → text-only card, which still unfurls. **Don't copy another viz's hero** — scaffold it, so it's built on `/_kit/viz-og.css` and re-themes with the viz. The full ladder, the capture/normalize recipe, and why 1200×630 specifically: `reference/publishing.md`.

**Before every publish: scan each viz's `recordings.json` for secrets** (keys, tokens, internal hosts, customer data) and advise the user — the tool seals whatever's on disk, so sanitizing is your job, especially for `public` vizzes which have no encryption backstop.

**Everything else about publishing lives in `reference/publishing.md`** — read it when you actually need one of these, not before:

| If the user wants… | Look for |
|---|---|
| a private viz that still unfurls a preview card | the **share shim** (secret path, holds the card, redirects into the sealed page) |
| the whole site behind one password | **private lobby** (`touch <container>/_private-lobby`) |
| a card blurred until clicked | **spoiler cards** (`viz:spoiler`) |
| to hide a viz from the lobby index | the **listing** axis |
| the lobby's own preview card, list/grid views, an intro blurb | **the lobby** section (`_preamble.html`, montage OG) |
| to revoke and re-issue a link | `rotate` (per-viz or `--lobby`) |
| the full posture/listing/kind meta syntax | **posture is per-viz** |

## Changing an existing viz

To **move/rename** a viz, flip its **posture/listing/kind**, or edit its **mirror/vendor declarations** — use `manage.ts` rather than hand-editing files. It's author-side only (never builds, never deploys), names a viz by its **folder path**, and auto-commits with surgical staging.

```bash
bun "$SKILL_DIR/manage.ts" move   <viz-folder> <dest-folder>
bun "$SKILL_DIR/manage.ts" update <viz-folder> [--posture …] [--listed …] [--kind …]
bun "$SKILL_DIR/manage.ts" mirror <ls|add|update|rm> <viz-folder> [--to …] [--access …] …
bun "$SKILL_DIR/manage.ts" vendor <viz-folder> --to <sink-viz-pages> --access public|private
```

Flags, failure modes, and the gotchas that bite (a move 404s the old URL; `mirror add` and `vendor` both require `--access`): `reference/manage.md`.

**One viz in two places** — `mirror` ships a *built artifact* the sink can't edit; `vendor` ships a *verbatim source copy* the sink owns and can run standalone. Both declare their edges at the origin. Which to pick, and what `--access` means for each: `reference/manage.md`.

## Conventions

- **Slug naming**: kebab-case, descriptive of the *thing being visualized*, not the technology used. `repo-import-graph` good; `d3-chart` bad.
- **Files in slug dir**: free-form. Common: `index.html`, optional `api.ts`, optional `data.json` and other assets.
- **Grow the kit, deliberately**: if you hand-roll something generic enough that you'd want it next time, jot a one-line note in `kit/CANDIDATES.md` — in the moment, without refactoring mid-build. Promotion into `viz.js`/`viz-kit.css` happens in a separate review once a pattern has actually recurred (~3+ vizzes) or proved error-prone. Don't pre-emptively over-build the kit; let it earn its weight.

**Managing the running system** — browse all vizzes, rescan, per-viz git history, rollback, stop the server: see `reference/ops.md`.

## When NOT to use this skill

- A single static SVG fits inline in the chat — just write it inline.
- The user wants shapes/text/arrows on a freeform canvas — `tldraw-canvas` is built for that.
- The visualization is text/ASCII — render in the terminal.
- The user is iterating on real production UI — don't pollute the viz data dir (`$VIZ`); work in their actual project.
