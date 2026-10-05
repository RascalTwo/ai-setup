# /viz — full mode (Bun toolchain)

You are here because the mode check in `SKILL.md` resolved to **full**. Everything in
`SKILL.md` still applies — the ambition bar, the form menu, the kit, the diagram rules.
This file is the core loop: create, write, hand off, verify, commit. Everything else is
routed from **Where to go next** at the bottom.

## Contents
- The CLI
- Paths — resolve these, never hardcode
- Step 1: Create
- Step 2: Write the visualization
- Step 3: Hand off, verify, commit
- Where to go next

## The CLI

`viz` in these docs means `bun "$SKILL_DIR/viz.ts"`. `viz --help` lists every verb;
`viz <verb> --help` is the flag reference. Pass `--json` on any verb whose output you parse
— stdout under `--json` is the record and nothing else.

## Paths — resolve these, never hardcode

Set these once at the start of a viz task and reuse them. Do **not** assume `~/.claude/...`.

**`$SKILL_DIR` — where this skill's code lives.** The directory containing `SKILL.md` and
`viz.ts`. Prefer the directory your agent loaded this skill from; otherwise:

```bash
SKILL_DIR="${VIZ_SKILL_DIR:-$HOME/.claude/skills/viz}"
```

Only if that path doesn't exist, search: `SKILL_DIR=$(dirname "$(find ~ -path '*/skills/viz/viz.ts' 2>/dev/null | head -1)")`
— it scans your whole home dir (~14s) and **resolves symlinks**, so it can hand back a
different path than the one you loaded the skill from.

**`$VIZ` — the central library (viz pages + its git repo).** The CLI resolves it itself; you
need it only for the git commands below:

```bash
VIZ="${VIZ_PAGES_DIR:-$([ -d ~/.agents/state/viz ] && echo ~/.agents/state/viz \
  || { [ -d ~/.viz-pages ] && echo ~/.viz-pages; } \
  || { [ -d ~/.claude/viz-pages ] && echo ~/.claude/viz-pages; } \
  || echo ~/.agents/state/viz)}"
```

The two older paths are still checked so a library that hasn't moved keeps loading. Set
`VIZ_PAGES_DIR` to relocate.

## Step 1: Create

Pick a kebab-case slug describing the *thing being visualized*, not the technology
(`repo-import-graph`, not `d3-chart`). Run `viz templates` first (the rule is in `SKILL.md`).

**Check what already exists.** Once a library has accumulated, the fastest way to a good viz
is forking one — the layout and interaction wiring are already solved somewhere.
`viz search <term>` matches the page *source* as well as title and tags, so it finds the viz
that drew a Sankey even if its title never says so; `viz create <slug> --from <viz-folder>`
forks it (posture always resets to `local`/`unlisted` — a trust decision is never inherited).
**On a fresh install these return nothing, and that is fine** — take a template or the blank
starter; don't stall hunting for prior art that can't exist yet.

**Central (default)** — `viz create <slug>` writes `$VIZ/<slug>/index.html` and its `app.ts`, starts the
server if needed, commits, opens a browser tab, and prints the URL and a `Session: <id>`.
Capture the session id: every later commit to this viz carries it as a trailer.

**Repo-local (`--local`)** — use when the viz belongs *with* a project and should be
versioned alongside its code. It lands in `<repo>/viz-pages/<slug>/`, is registered so the
server serves it immediately, and **is not committed** — you commit it in the host repo with
that project's conventions (no `Session:` trailer). It must live under your home directory.
Whether to also vendor a standalone runtime (`--runtime`): `reference/ops.md`.

It **fails loud** if the slug exists or port 5180 is taken by something else. Surface the
error verbatim; don't pick a different slug unless the user agrees.

## Step 2: Write the visualization

`create` printed the new `index.html`, so you can edit it without reading it back (a page
over 8KB — a deck — isn't dumped; read that one, its comments are the authoring guide).
**Keep the `viz:*` meta lines**; they carry the safe-default posture. Edit everything else.

- **Hand-rolled SVG and CSS grid is the default, not a fallback.** Across the corpus: 95% of
  vizzes use CSS custom properties, 86% an ES module, 82% the kit stylesheet and
  CSS grid, 61% inline SVG. There is no build step anywhere — no viz has a `package.json`.
- **Reach for a library only when the maths earns it** (~16 CDN imports across 257 vizzes:
  three.js, elkjs, d3, the odd mermaid). Import as an ES module:
  `import * as d3 from "https://esm.sh/d3@7"`.
- **No framework.** React, Vue and Tailwind have never been used. A page that needs a
  framework is usually a page that picked the wrong form.
- Inline data as a `<script>` blob, or write `data.json` beside the page and `fetch` it.
- **The code is TypeScript:** `app.ts`, loaded by the page as `./app.js`. Read
  `reference/typescript.md` before you write it.

**Every save is a full page reload**, so in-page JS state is lost. Persist anything that
must survive (open panel, selected step, filters) with `saveHash()`/`loadHash()`.

**Needs live data** (shell commands, file reads, streaming), or must work away from its data
source? Read `reference/backend.md` before writing `api.ts`.

**Is a timed film** (a duration, wanted as video)? Read `reference/timeline.md` first — the
seek contract shapes the code from the start, and `viz render` turns it into an mp4 (narration
and captions from `narration.json`) when it's done.

## Step 3: Hand off, verify, commit

**Say the URL in prose as soon as it renders something real** — not at the end of your turn.
When you hand back, post `ready` (`building` is inferred from every file write):

```bash
curl -sX POST --data ready "http://127.0.0.1:5180/<viz-id>/_status"
```

**Then verify — always, before every commit.** Past vizzes shipped overflowing labels,
disconnected arrows and blank pages from a 404'd import, then took several follow-up commits
to clean up. `viz verify <url>` drives headless Chrome once and prints a layout audit and a
density line; it writes `latest.png`, `console.txt`, `network.txt` and `dom.html` under
`<viz>/.verify/`. Run it *after* handing off — it can take minutes. First use needs
`bun install` in `$SKILL_DIR` (it drives your installed Chrome; set
`PUPPETEER_EXECUTABLE_PATH` if Chrome isn't at the default location).

- **Errors reported → read `<viz>/.verify/console.txt`** and fix them. Console errors mean broken,
  however it looks.
- **Read `<viz>/.verify/latest.png` at least once before you call it done.** `⚠ 0 layout
  finding(s)` means "nothing is broken", not "it looks good".
- **More than one state → verify more than one state.** A plain run only sees the opening
  frame, which is how nearly every interactive viz shipped unlooked-at past it.

**Read `reference/verify-states.md`** when the viz has more than one state (the interactions
recipe). **Read `reference/verify.md`** when a report line needs interpreting, or before
trusting a clean run on a diagram — each audit check is narrower than its name.

**A viz that computes what it shows** — from the user's input, live data or an `api.ts` — needs
its own tests, and verify will fail it until it has them (or opts out with a reason). Read
`reference/testing.md`.

**Commit after each coherent change.** `viz verify <url> --commit="<slug>: <message>"`
commits only if the run is clean, in whichever repo owns the viz, and only that viz's files,
adding the `Session:` trailer for central vizzes. By hand, for a central viz:

```bash
cd "$VIZ" && git add <slug>/ && git commit -m "<slug>: <semantic message>

Session: <session-id>"
```

Messages say what changed for the reader: `import-graph: color edges by file size, switch to
log scale`. Under Claude Code the id is also `$CLAUDE_CODE_SESSION_ID`. A repo-local viz is
committed in its host repo with that project's conventions.

**Iterating** is the same loop on the same files. A *new, separate* viz gets a fresh slug.

## Where to go next

| When | Read |
|---|---|
| the user wants it online, shared, or previewed as deployed | `reference/publishing.md` |
| moving, renaming, deleting, approving, retitling, history/rollback, mirrors, vendoring, ranking, deployed URLs | `reference/manage.md` |
| the user left feedback on the page (spoke or Alt-clicked), or says "see my comments/feedback" | `reference/review-layer.md` |
| the server, rescan, adopting HTML you didn't scaffold, a standalone repo runtime, driving this from a chat app | `reference/ops.md` |

**Grow the kit deliberately.** If you hand-roll something generic enough to want next time,
add a one-line note to `kit/CANDIDATES.md` in the moment, without refactoring mid-build.
Promotion into the kit is a separate review once a pattern has recurred (~3+ vizzes).
