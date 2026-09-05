# /viz — full mode (Bun toolchain)

You are here because the mode check in `SKILL.md` resolved to **full**. Everything in
`SKILL.md` still applies — the ambition bar, the form menu, the kit, the diagram rules.
This file is the mechanics: where things live, how to create them, verify them, commit
them and publish them.

## The CLI

One entry point, verbs grouped by what you are trying to do:

```bash
bun "$SKILL_DIR/viz.ts" --help            # every verb the system has
bun "$SKILL_DIR/viz.ts" <verb> --help     # that verb's flags, generated from the parser
```

**Do not memorise the flag surface from this file — ask the CLI.** `viz create --help`,
`viz verify --help`, `viz publish --help` and the rest are generated from the same
declarations the parser uses, so they cannot drift from what the code actually accepts.
This document deliberately stops restating them.

The verbs, by group:

| | |
|---|---|
| **create** | scaffold a new viz |
| **verify**, **check** | confirm it renders; structural check of an exchange |
| **ls**, **search**, **move**, **delete**, **update**, **history**, **rollback**, **mirror**, **vendor** | the library |
| **server** `start\|stop\|status\|rescan` | the local server |
| **publish**, **preview**, **export**, **rotate**, **deploy-all**, **sync-runtimes** | getting it online |

**`--json` works on every verb an agent or CI calls** — `create`, `verify`, `publish`,
`export`, `ls`, `search`, and the server verbs. Prefer it over scraping the human output;
stdout under `--json` is the record and nothing else.

**`viz <verb> --examples`** prints worked examples for the verbs that have them, kept out
of `--help` so asking for flags does not cost you a page of prose. `viz --examples` lists
which verbs carry them.

## Running it from a chat app

Claude Desktop and ChatGPT have no shell, but they run local MCP servers as ordinary host
processes. `mcp.ts` is that server, and its tools are generated from this same command
tree — so every verb here is reachable there, and neither surface can drift from the
other. Claude Desktop additionally gets a one-click `.mcpb` bundle with Bun inside; the
install guide in the self-portrait has the download and the per-host instructions.


The old per-script entry points (`bootstrap.ts`, `manage.ts`, `verify.ts`, `build.ts`) still
work and are unchanged from the outside — they are thin shims over the same `lib/` modules
the CLI calls. Nothing needs migrating.

## Architecture

Architecture: a singleton Bun server at `127.0.0.1:5180` serves vizzes from **many roots**, not one. There's the central library (`$VIZ`, resolved below — one git repo), plus **repo-local vizzes**: any `viz-pages/` folder living inside one of your own repos. The server is lazy-spawned by the bootstrap script and persists across sessions.

A viz is identified by **its path relative to your home directory**, which is also its URL — e.g. central `~/.claude/viz-pages/foo` serves at `/.claude/viz-pages/foo/`, and repo-local `~/Code/app/viz-pages/bar` serves at `/Code/app/viz-pages/bar/`. Real filesystem paths are globally unique, so two repos can both have a `dashboard` viz and never collide.

Repo-local vizzes are auto-discovered on server start (or via Rescan); creating one registers it immediately. Mechanics in `reference/ops.md`.

Bun is the only prerequisite (pure Bun, no shell utils → runs on macOS/Linux/Windows; install from [bun.sh](https://bun.sh) if `bun --version` fails). Nothing is hardcoded to a specific agent or install path — resolve the two paths below instead of assuming locations.

## Paths — resolve these, never hardcode

Set these once at the start of a viz task and reuse them. Do **not** assume `~/.claude/...`.

**`$SKILL_DIR` — where this skill's code lives.** It's the directory containing *this* `SKILL.md`, alongside `viz.ts` (the CLI) and `server.ts`. Prefer the directory your agent loaded this skill from; otherwise:

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

Argument: `/viz [name] [--local [dir]] [--global] [--deck] [--poster] [--poster-dive] [--exchange] [--hero] [--quick]` — optional human-readable slug (e.g. `import-graph`, `bar-chart-population`). If absent, pick one based on what's being visualized. Use kebab-case.

Four scaffolds replace the blank starter when the viz has a known shape; each stamps a `viz:scaffold` meta and carries its own authoring guide inside the file it generates. Default to the blank starter — reach for a scaffold only when the shape genuinely matches.

| flag | use it when the viz is… |
|---|---|
| `--deck` | a presentation you arrow-key through, slide by slide |
| `--poster` | *itself* a 1200×630 share card, and nothing more |
| `--poster-dive` | that card on top, with a scrollable deep dive below it |
| `--exchange` | something passed/proven between parties — actors, packets, stepped narration |
| `--hero` | (add-on, not a scaffold) a normal page that needs a share card *different* from itself |

**If you're using one of these, or editing a page that already carries `viz:scaffold`, read `reference/scaffolds.md` first** — what each one gives you, the safe zones, and the three rules that keep the meta readable. Skip it for a plain page.

**Check what already exists first.** Once a library has accumulated, the fastest way to a good viz is usually forking a good one — the SVG scaffolding, the layout, the interaction wiring are all already solved somewhere:

```bash
viz search sankey        # matches path/title/tags AND page source
viz ls --posture=public  # or just list them, newest first
viz create <new-slug> --from <viz-folder>   # fork one
```

`search` reads the page source, not just metadata, so it finds the viz that *drew* a Sankey even if its title never says so. A fork copies everything but **always resets to `local`/`unlisted`** — posture is a trust decision and is never inherited — and drops the source's `comments.json`, `og.auto.png` and `recordings.json`.

**On a fresh install these return nothing, and that is fine** — the library starts empty and fills up as you work. Don't stall hunting for prior art that can't exist yet: take the scaffold that fits (above), or start from the blank starter and the kit. The bundled `viz-self-portrait` is the one page always present, and it's a real worked example if you want to read one.

**Central (default).** With no flag, the viz is created in the central library and committed to its git repo — the normal, throwaway scratch space:

```bash
viz create <slug>
```

The script scaffolds `$VIZ/<slug>/index.html` (pre-stamped with the safe-default `viz:posture=local` + `viz:listed=unlisted` metas — invisible until you open it up, see Step 4), spawns the server if needed, commits with a `Session:` trailer, and prints the URL + session ID. It **fails loud** if the slug already exists (pick another, e.g. `-v2`) or if port 5180 is taken by something else.

Capture the printed `Session: <id>` — you'll reuse it as the trailer on every subsequent commit for this central viz.

**Repo-local (`--local`).** Use this when the viz belongs *with* a project — it visualizes that repo's architecture/data and should be versioned alongside its code:

```bash
viz create <slug> --local            # in the cwd's git repo
viz create <slug> --local <dir>       # in an explicit dir
```

In local mode the script creates `<repo-root>/viz-pages/<slug>/` (repo root via `git rev-parse --show-toplevel`; or `<dir>/viz-pages/<slug>/` when a dir is given), registers it in `$VIZ/.discovered.json` so it's discoverable immediately, and **does not touch git** — it prints a `git add` hint instead. The viz is committed in the **host repo**, by you, with that project's normal conventions (no `Session:` trailer). The viz dir must live under your home directory (that's where discovery looks). `--global` forces central even when run inside a repo.

Add `--runtime` to also vendor a self-contained server into `<repo>/viz-pages/.runtime/`, so the repo's vizzes stay **independently runnable with no skill installed**. **Ask for it only when a cloner really will run the vizzes without the skill** — registration, which is what makes your own server serve them, happens either way. Why the default is opt-in, and the sweeper that keeps a vendored copy fresh: `reference/ops.md`.

If the script errors, surface the error verbatim. Don't try to recover by picking a different slug unless the user agrees.

## Step 2: Write the visualization

> **Bootstrap already created `index.html`** (pre-stamped with posture metas) **and printed it to stdout** — so you can `Edit` it straight away without reading it back. Keep the `viz:*` meta lines; edit everything else freely. (`--deck` is the exception: its template is large, so it isn't dumped — read that one.)

**The *what* lives in `SKILL.md`** — picking the visual form, starting from the viz kit, and
the boxes-and-arrows rules are all there, and you should have read them before arriving here.
What follows is only the full-mode plumbing.

### Tooling

Bootstrap already left a starter `$VIZ/<slug>/index.html` carrying `viz:posture=local` + `viz:listed=unlisted` (safe on both axes). **Edit that file** (don't blind-overwrite the whole thing away) — keep those two lines, changing `posture` to `public`/`private` and `listed` to `listed` only when the user wants to publish/advertise (Step 4). Write any other files you need alongside it. The viewport is the user's browser, so be ambitious:

- **Hand-rolled SVG and CSS grid is the default, not a fallback.** Measured over the
  corpus: 95% of vizzes use CSS custom properties, 86% an ES-module `<script>`, 82% the
  kit stylesheet and CSS grid, 61% inline SVG. Canvas appears twice. There is no build
  step anywhere — not one viz has a `package.json`.
- **Reach for a library only when the maths earns it.** Across 257 vizzes there are ~16
  CDN imports total: three.js for 3D, elkjs past ~5 nodes, d3 for layout maths, plus the
  odd mermaid/dagre/marked. Import as an ES module and nothing needs installing:
  `import * as d3 from "https://esm.sh/d3@7"`.
- **No framework.** React has never been used in a single viz, and neither has Vue or
  Tailwind. A page that needs component state has `stepper()` and `saveHash()`; a page
  that needs a framework is usually a page that picked the wrong form.
- Inline data as `<script>` blobs, or write `data.json` and `fetch("data.json")`
- TypeScript belongs in `api.ts` (Bun runs it), never in the browser — the page is
  plain JS so it opens without a toolchain.

The server auto-injects an SSE reload script into served HTML. Saves trigger a full page reload, so in-page JS state is nuked — don't rely on it surviving. Persist anything that must survive to the URL hash (`saveHash`/`loadHash` from the kit).

### If you need a backend, streaming, or a frozen tape

A viz can expose a Bun-backed `api.ts` for live data (shell commands, file reads), stream it over SSE, and record a **tape** so an api-backed viz survives away from its data source. Full details — handler shape, relative-URL rule, hot-reload caveat, secret redaction, SSE vs POST loop, live-demo fallback, and the `--record`/`--frozen` tape recorder: see `reference/backend.md`.

### If the viz is a timed film

A viz with a duration that plays start-to-finish — a narrated explainer, a motion graphic, anything you'd want an `.mp4` of — must expose a **seek contract**: `window.__viz = { total, goTo(t), pause() }`, where `goTo` renders any moment on demand without having played up to it. Two functions and a number.

Everything downstream depends on it. Verification becomes "seek to each chapter and screenshot" instead of watching. Video capture becomes frame-accurate and headless instead of a real-time take — measured, a 7-minute wall-clock recording drifted **+5.2%** against the page's own clock, while the same piece captured by seeking was exact. And `prefers-reduced-motion` falls out of the same mechanism for free.

You do **not** need an animation library or a declarative `f(t)` engine for this; a flat beat list with CSS transitions, replayed with transitions off, is enough and won a head-to-head against one. Contract, the beat-replay pattern, the capture recipe, and the one-line check: see `reference/timeline.md`.

## Step 3: Verify, then commit after each logical change

### Verify before you commit

The viz isn't done when the code is written — it's done when it renders correctly. Past vizzes shipped layout bugs (overflowing labels, disconnected arrows) and silent JS errors (a typo'd function, a 404'd CDN import → blank page, no signal) that then took several follow-up commits to clean up, because nothing was checked before committing. **Always run the render check before committing** — don't eyeball it and hope:

```bash
viz verify <url>        # url that bootstrap printed
viz verify <url> --wait='.chart' --full   # wait for a selector, full-page shot
```

First use needs `bun install` in `$SKILL_DIR` (pulls puppeteer-core; it drives your already-installed Chrome — no Chromium download). Set `PUPPETEER_EXECUTABLE_PATH` if Chrome isn't at the default location.

It drives headless Chrome once, writes `latest.png` / `console.txt` / `network.txt` / `dom.html` under `$SKILL_DIR/.verify/`, and prints two reports to stdout: a **layout audit** (text spilling its box, content clipped by an `overflow:hidden` ancestor, anything wider than the viewport, escapes from a 1200×630 `.og-card`, a blank render, plus a mark census) and an informational **visual-density** line. Neither blocks a commit.

Three rules, and then the detail is in `reference/verify.md`:

- **If it reports errors, read `.verify/console.txt`** and fix them. A viz with console errors is broken even if it looks fine.
- **Read `.verify/latest.png` at least once before you call the viz done.** `⚠ 0 layout finding(s)` means "nothing is broken", not "it looks good" — spacing rhythm, hierarchy and whether the thing actually *reads* are yours to judge. Fix findings from stdout instead of hunting for them in the shot; that part is free.
- **If the viz has more than one state, verify more than one state.** Steps, tabs, drawers, hover, an animation with a destination — a plain run only ever sees state 1, which is how nearly every interactive viz in the corpus shipped unlooked-at past its opening frame. Drop a disposable `verify.interactions.ts` beside the page to click through them and snap your own extra PNGs; **recipe in `reference/verify.md`**.

`reference/verify.md` also covers which artifact answers which question, how to read the density bands, and what to check on a backend viz.

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
viz verify <url> --commit="<slug>: <semantic message>"
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
viz preview <container> [--port <n>] [--open]   # see the real deployable bytes, locally
viz publish <container> [--out <dir>] [--base-url <url>] # build a whole container
viz rotate <vizDir>                             # revoke + re-mint a private magic link
viz rotate <container> --lobby                  # revoke + re-mint a container's LOBBY key
```

Each viz declares its own **posture** (`public`/`private`/`local`) and **listing** (`listed`/`unlisted`) via `<meta>` tags in its `index.html` — there are no CLI flags for these. An undeclared posture makes the whole run refuse. `build.ts` writes artifacts to a `dist` dir but **never deploys** — deploying is a separate, human-confirmed step, run per-container with `bash <container>/deploy.sh` or across every container set up for it with `viz deploy-all`. Both are described in `reference/publishing.md`.

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
| to actually push the built bytes to a host, one container or all of them | **deploying** (`deploy.sh`, `deploy-all.ts`) |

## Changing an existing viz

To **move/rename/delete** a viz, flip its **axes**, or edit its **mirror/vendor declarations** — use `manage.ts` rather than hand-editing files. It's author-side only (never builds, never deploys), names a viz by its **folder path**, and auto-commits with surgical staging.

```bash
viz move   <viz-folder> <dest-folder>
viz delete <viz-folder>
viz update <viz-folder> [--posture …] [--listed …] [--triaged …]
                                               [--title …] [--description …] [--tags a,b,c]
viz mirror <ls|add|update|rm> <viz-folder> [--to …] [--access …] …
viz vendor <viz-folder> --to <sink-viz-pages> --access public|private
```

Run `viz` with no arguments for the full verb list — it prints the vendor sub-verbs (`vendor-ls/-rm/-sync/-check/-guard`) this summary leaves out.

Flags, failure modes, and the gotchas that bite (a move 404s the old URL; `mirror add` and `vendor` both require `--access`): `reference/manage.md`.

**One viz in two places** — `mirror` ships a *built artifact* the sink can't edit; `vendor` ships a *verbatim source copy* the sink owns and can run standalone. Both declare their edges at the origin. Which to pick, and what `--access` means for each: `reference/manage.md`.

## Conventions

- **Slug naming**: kebab-case, descriptive of the *thing being visualized*, not the technology used. `repo-import-graph` good; `d3-chart` bad.
- **Files in slug dir**: free-form. Common: `index.html`, optional `api.ts`, optional `data.json` and other assets.
- **Grow the kit, deliberately**: if you hand-roll something generic enough that you'd want it next time, jot a one-line note in `kit/CANDIDATES.md` — in the moment, without refactoring mid-build. Promotion into `viz.js`/`viz-kit.css` happens in a separate review once a pattern has actually recurred (~3+ vizzes) or proved error-prone. Don't pre-emptively over-build the kit; let it earn its weight.

**Managing the running system** — browse all vizzes, rescan, per-viz git history, rollback, stop the server: see `reference/ops.md`.

