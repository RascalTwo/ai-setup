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

**`$SKILL_DIR` — where this skill's code lives.** It's the directory containing *this* `SKILL.md`, alongside `bootstrap.ts` and `server.ts`. Use the directory your agent loaded this skill from. If you don't know its absolute path, find it (searches your home dir and the current project):

```bash
SKILL_DIR=$(dirname "$(find ~ . -path '*/skills/viz/bootstrap.ts' 2>/dev/null | head -1)")
```

**`$VIZ` — where viz pages and the git repo live.** `bootstrap.ts` and `server.ts` resolve this internally, so you don't need it just to run them. For the ops/git commands below, resolve it the same way they do:

```bash
VIZ="${VIZ_PAGES_DIR:-$([ -d ~/.viz-pages ] && echo ~/.viz-pages || echo ~/.claude/viz-pages)}"
```

Resolution order is `$VIZ_PAGES_DIR` → `~/.viz-pages` (neutral default) → `~/.claude/viz-pages` (legacy, kept so pre-existing libraries still load). Set `VIZ_PAGES_DIR` to relocate.

## Step 1: Bootstrap

Argument: `/viz [name] [--local [dir]] [--global] [--deck] [--poster]` — optional human-readable slug (e.g. `import-graph`, `bar-chart-population`). If absent, pick one based on what's being visualized. Use kebab-case.

**Slide deck (`--deck`).** For an arrow-key presentation deck (title → content slides → close) rather than a single-screen viz, add `--deck`. It scaffolds a self-contained deck instead of the blank starter: a scale-to-fit 16:9 canvas, `←/→/space` navigation with `F` fullscreen, an auto progress bar, `.reveal` entry cascades, and **reversible per-slide fragments** (`.frag` — arrow reveals the next build step within a slide, then advances). Zero external assets (fonts via CDN); add slides by copying a `<section class="slide">`. The starter carries an authoring-guide comment. Composes with `--local`/`--global`.

**Self-hero poster (`--poster`).** For a viz that is *itself* an OG card — a single screenshot-first frame meant to be shared as a link preview — add `--poster`. It scaffolds a fixed **1200×630** `.og-card` (scale-to-fit like `--deck`, safe-zone baked in) stamped `viz:card=self`, meaning the page **is** its own hero: `verify.ts --og` clips its `.og-card` straight to `og.auto.png` with no separate `hero.html`, and `build.ts` treats that as the polished card (no nag). **1200×630 (1.91:1) is the one ratio verified to unfurl cleanly on Slack, X, Teams, WebEx, and Discord** — those platforms center-crop anything taller to a wide band, so square/16:9/vertical lose their top and bottom on link posts; the scaffold is fixed at 1200×630 for that reason. Keep key content in the center ~1080×565 safe zone (toggle the dashed guide with class `show-safe` while composing). Composes with `--local`/`--global`. (A separate hand-authored `hero.html` is still the way to give a *non-poster* viz a distinct card; `--poster` is for when the whole viz is the card.)

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

> **Bootstrap already created `index.html`** in the slug dir (pre-stamped with posture metas). **Read it first, then `Edit` it** — or overwrite with `Write` only *after* reading. A blind `Write` to a file you haven't read fails the harness's read-before-write guard, so don't reach for `Write` as your first move here.

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

**Fallback hierarchy.** A real spatial form > a styled page > terminal text. A styled page (cards, colored tables, typographic hierarchy) is acceptable when no spatial encoding genuinely fits — it's the bottom of the barrel, not banned, and still beats text in a terminal. But if the content has magnitudes, relationships, sequences, hierarchy, or topology, there's a real form for it — find that first. Never exit saying "this isn't visualizable"; if all else fails, ship the styled page.

**Exception:** if the user asked to design a UI or screen, the UI itself is the visual artifact.

### Start from the viz kit

A shared kit is served at `/_kit/` (from the skill's own `kit/` dir). It exists because nearly every past viz re-derived the same dark palette, re-guessed the same hexes, and reinvented the same components and SVG math. Load it so you don't repeat that:

```html
<link rel="stylesheet" href="/_kit/viz-kit.css">
<script type="module">
  import { arrowMarkers, connect, side, labelBox, vizAudit, $, $$, esc, saveHash, loadHash } from "/_kit/viz.js";
  // ...your code
</script>
```

- **Colors** — reach for `var(--accent)`, `var(--good)`, `var(--warn)`, `var(--danger)`, and the `--c1`…`--c6` categorical ramp instead of picking new hexes. The house style is dark-only on purpose.
- **Chrome** — `.viz-header` (title + `.sub`), `.panel`/`.card`, `.legend`/`.swatch`, `.drawer` (toggle `.open`), `.flow` (animated dashed edge) are ready-made.
- **State across reloads** — persist anything that should survive a save (open panel, selected step, filters) with `saveHash()`/`loadHash()`; that also makes the view deep-linkable.

Full token + helper list: `/_kit/README.md` (or `kit/README.md` in the skill). The kit is opt-in and additive — skip it if a viz genuinely needs something else — but default to it.

### Drawing SVG diagrams without the usual rework

Boxes-and-arrows diagrams are where past vizzes bled the most iteration — labels overflowing their boxes, arrows pointing at empty space or the wrong box, whole diagrams re-laid-out late. The root cause was always the same: coordinates typed as independent literals, then guessed wrong. Avoid it structurally rather than fixing it after the fact:

- **Define each node once** as `{x, y, w, h}`, then compute every arrow endpoint and label position *from* that geometry (`connect(a, b)`, `side(node, "right")`) — never as a separate literal. Now moving or resizing a box can't strand its arrows.
- **Budget the layout up front** — decide the container width and column positions before placing anything, so the Nth element doesn't blow past the edge and force a redo of the whole row.
- **Labels: use `labelBox(node, html)`** (a `<foreignObject>`) for anything multi-word — the browser wraps and ellipsizes, so text *cannot* spill. Raw `<text>` has no overflow protection; you'd be back to measuring widths by hand (which is exactly what kept going wrong).
- **Arrowheads: `arrowMarkers()`** emits stable-id markers once; reference `marker-end="url(#ah-accent)"`. SVG markers can't inherit a line's color, so you need one per color — the helper handles that instead of you copy-pasting a `<marker>` block per hue.
- **More than ~5 nodes with crossing edges** — stop hand-placing and use a layout engine (dagre, d3-dag, mermaid). Manual coordinate math past that size is where the rework lives.
- **If you do hand-roll `<text>`**, call `vizAudit()` after render: it red-outlines any label that spills its box and shows a banner, so an overflow is visible in the open browser (and in any screenshot) instead of discovered three commits later.

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
| `latest.png` | screenshot | always — to judge the render |
| `console.txt` | console + uncaught errors + failed requests | the run reports `✗ N error(s)` |
| `network.txt` | full request + response (headers + bodies) | a fetch/CDN/api call looks wrong |
| `dom.html` | final DOM after load + interactions | you need to inspect rendered structure |

The stdout line says `✓ 0 error(s)` or `✗ N error(s)` with the first few inline — so:

- **If it reports errors**, read `.verify/console.txt` for the full list (uncaught exceptions, bad CDN imports, api 500s). Fix them — a viz with console errors is broken even if it looks fine.
- **Read `.verify/latest.png`** to judge the render: for an SVG diagram, confirm no label spills its box and every arrow connects the boxes you meant (`vizAudit()` red-outlines `<text>` overflows so they show in the shot). This is cheaper than driving Chrome MCP — console is text, and it's one command, not a live browser session.
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

There's no hook safety net. If you forget to commit, the changes get bundled into the next commit. Inconvenient but recoverable. Don't forget.

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

**Spoiler cards (`<meta name="viz:spoiler" content="true">`).** Opt-in, off by default. Marks a viz as spoilery so the lobby **blurs its hero image and its blurb** until the viewer clicks that card once to reveal (the title stays visible, and it re-blurs on reload). This lets you author an honest, spoiler-full hero + `viz:description` instead of a watered-down one. It only guards the **lobby**, not the OG unfurl — a link shared into Slack/Discord still previews the full hero (that surface is the poster's to strip).

**Rich link previews (Open Graph):** every **public** viz publishes with OG/Twitter-Card `<meta>` auto-built from its `viz:title`/`viz:description`, so its URL unfurls a preview card in Slack/Discord/Webex/etc. The **card image** (static, 1200×630, ≤~300 KB) comes from the viz's source dir, picked by provenance (the filename is the fingerprint — no embedded metadata):

- `og.png` / `og.jpg` — **human-made, preferred.** Supply one: hand the agent an image (file path or clipboard) and it normalizes it (center-crop 1.91:1 → scale 1200×630 → compress) into place.
- `hero.html` — **a hand-authored card, in HTML.** Drop a self-contained `hero.html` in the viz dir whose 1200×630 OG surface is an element with class `.og-card` (or `.card`); `verify.ts --og` renders it and clips to that element → `og.auto.png`. Best of both: a designed card (in the same CSS as the viz, `/_kit/viz-kit.css` if you want the tokens) that regenerates on re-running `--og`. build.ts treats a hero-backed `og.auto.png` as polished (no nag) and warns only if the `hero.html` is newer than the shot.
- `og.auto.png` — **auto fallback**, written by `bun "$SKILL_DIR/verify.ts" <id> --og`. With a `hero.html` present it's the hero card (above); otherwise a 1200×630 shot of the live page (driven by `verify.interactions.ts` if present), which `build.ts` **warns at publish** still wants a real picture.

No image, or no `--base-url`, → a text-only card (still unfurls). Full capture/normalize recipe: `reference/publishing.md`.

**Private vizzes unfurl too — via a share shim.** A sealed page's head is encrypted, so it can't carry a card directly. Instead each `private` viz also publishes a tiny **unsealed shim** at a secret path (`<slug>/<staticrypt-hash>/`): its head holds the OG card, its body JS-redirects to the sealed page's `#staticrypt_pwd` magic link. Crawlers don't run JS, so they read the card and stop; humans bounce through and auto-decrypt. The **shim URL is what you share** (it's the `🔗` build prints) — the raw fragment link is now just an internal redirect target. The shim path *is* the staticrypt hash (one secret, doubling as the unguessable locator and the decrypt credential), and the card image lives under that same secret path, so **nothing leaks at a guessable URL** — the card is only ever served to someone who already holds the link. `rotate` re-mints the hash → new shim URL, old one dead. Needs `--base-url` (a shim needs an absolute host); without it, private vizzes fall back to the raw magic link. **Caveat:** this assumes your `gh-pages` source repo is **private** — in a public repo the shim's path *and* its baked-in credential sit in the repo tree for anyone to read (and you shouldn't be sealing content in a public repo anyway).

**Private lobby — seal the whole lobby behind ONE password.** A lobby is public by default. Drop an empty marker file `_private-lobby` in the container root (`touch <container>/_private-lobby`) to make it **private**: the entire published site is StatiCrypt-sealed behind a single **lobby** password — the lobby page itself **and** every `public` viz in it. A visitor enters the password once — or opens the printed magic link, which carries `&remember_me` — and every public page auto-decrypts as they browse (no re-prompt), because they all share one passphrase+salt. Vizzes declared `private` keep their **own** separate key: a lobby holder sees their (minimal) card but still needs that page's own link — deliberate compartmentalization. The lobby key is **auto-minted into the machine-local keystore** (keyed `<container>#lobby`), exactly like a private viz's key — it never touches git and re-mints on a fresh clone (old link dies). The marker is **presence-only** (contents ignored), is **never** emitted into the built output, and is the *only* lobby thing that's committed. `preview` seals too, so you see the locked site before deploying. If the marker is present but the container is outside `$HOME` (unkeyable), the build **refuses** rather than publish in the clear. Full walkthrough: `reference/publishing.md`.

**Before every publish: scan each viz's `recordings.json` for secrets** (keys, tokens, internal hosts, customer data) and advise the user — the tool seals whatever's on disk; sanitizing is your job, especially for `public` vizzes which have no encryption backstop.

Full details — the postures/listing/kind semantics and meta syntax, `preview` behavior, the multi-viz lobby (incl. its **List/Grid** view toggle — grid shows each viz's OG/hero image as a visual card — and an optional per-container `_preamble.html` intro above the cards), the secret-scan gate, and the deploy/rotate steps: see `reference/publishing.md`.

## Changing an existing viz

To **move/rename** a viz, flip its **posture/listing/kind**, or edit its **mirror declarations** deterministically — instead of hand-editing files — use `manage.ts` (author-side only; never builds or deploys). A viz is named by its **folder path**. Every operation is fail-closed, refuses a mirrored-in dir (edit the origin), and auto-commits with surgical staging (`--no-commit` to opt out).

```bash
bun "$SKILL_DIR/manage.ts" move   <viz-folder> <dest-folder>                       # relocate/rename (rename = same-parent move); migrates mirror config
bun "$SKILL_DIR/manage.ts" update <viz-folder> [--posture …] [--listed …] [--kind …]  # set axes (each validated against its enum)
bun "$SKILL_DIR/manage.ts" mirror <ls|add|update|rm> <viz-folder> [--to …] [--access …] …  # edit mirrors.json only (publish still pushes)
```

See ADR 0008 for the full design (a move changes the id → the old URL 404s; mirror `add` needs `--access`, everything else inherits the viz's meta).

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
