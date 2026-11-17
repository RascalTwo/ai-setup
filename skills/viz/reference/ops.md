# Operations & system internals

The server, discovery, adopting foreign HTML, standalone repo runtimes, and driving the
toolchain from a chat app. None of this is needed to *author* a viz — reach for it when
you're managing, debugging, or shipping the system itself.

## Contents
- How it's laid out
- The server
- Discovery of repo-local vizzes
- Adopting static HTML you didn't scaffold
- Standalone vendored runtime (`viz create --local --runtime`)
- Driving it from a chat app

## How it's laid out

A singleton Bun server at `127.0.0.1:5180` serves vizzes from **many roots**: the central
library (`$VIZ`, one git repo) plus **repo-local vizzes** — any `viz-pages/` folder inside
one of your repos. It is started on demand by `viz create` and persists across sessions.

A viz is identified by **its path relative to your home directory**, which is also its URL:
central `~/.agents/state/viz/foo` serves at `/.agents/state/viz/foo/`, repo-local
`~/Code/app/viz-pages/bar` at `/Code/app/viz-pages/bar/`. Real paths are globally unique, so
two repos can both have a `dashboard` and never collide. The path answers *"where is it?"*;
`viz:uid` (below) answers *"is this the same viz I saw before?"*

## The server

`viz server start | stop | status | rescan`. `start` is idempotent (it's what `create`, `verify <id>` and `render`
call); `status` says whether it's up, on which port and pid, and in which mode; `rescan` re-registers
repo-local vizzes without a restart. Logs at `$VIZ/.server.log`.

- **Browse everything** at `http://127.0.0.1:5180/` — it redirects to the self-portrait,
  which lists every viz with live stats, a Rescan button, and the management drawer.
- **Recording a tape.** An api-backed viz is recorded by running the server in record mode,
  and served from the tape in frozen mode — both are `viz server start` options (see its
  `--help`). The mode is process-wide and there is one server, so starting in a different
  mode refuses: stop it first. What a tape is and
  when you need one: `reference/backend.md`.
- **Keep it running across logins (macOS, optional)** — two launchd agents in `launchd/`
  keep it alive and restart it nightly. Install steps: `launchd/README.md`. With them
  installed, killing the server just makes launchd restart it — `launchctl bootout` first.

## Discovery of repo-local vizzes

On startup (and on `viz server rescan` or the Rescan button) the server deep-scans your home
directory for `viz-pages/` folders, caching them in the machine-local
`$VIZ/.discovered.json`. Creating a repo-local viz registers it immediately.

## Adopting static HTML you didn't scaffold

**Any folder with an `index.html` becomes a viz** — a reveal.js deck from another skill, an
exported report, a prototype someone handed you. It keeps its own markup, CSS and runtime,
and gains hot reload, the feedback widget, publishing and git history.

```bash
cp -R <their-folder>/. "$VIZ/<slug>/"   # or <repo>/viz-pages/<slug>/ for repo-local
viz server rescan                        # REQUIRED, including centrally
```

Then open `/<path-relative-to-$HOME>/`.

- **The rescan is not optional.** Measured: a folder dropped into `$VIZ` without one
  returns **404**; after it, 200.
- **Relative subpaths and foreign runtimes just work** — verified against a reveal.js deck
  with vendored JS, webfonts and ~100 PNGs: every asset 200, 0 console errors alongside the
  injected scripts.
- **To publish it, add the `viz:*` metas** (`posture`, `listed`). An undeclared posture
  makes the whole publish run refuse.
- **`viz:uid` is its durable identity** — what the pairwise ranking and other long-lived
  records key on, so they survive a move. An adopted folder has none until one
  is minted (`backfill-uids.ts` in `$SKILL_DIR`, dry-run by default). **Never copy another
  viz's uid**: two vizzes claiming one identity silently corrupt everything keyed on it
  (ADR 0014).
- **It does not get the kit** unless its own HTML links it — usually correct. Don't
  retrofit kit tokens into somebody else's design system.
- **Hot reload is a full page reload.** A page that keeps its position in the URL hash
  (reveal does) comes back where it was; one that doesn't resets to the top.
- **Don't edit adopted source to suit viz.** If it came from another skill or repo, change
  it there or send it upstream.

## Standalone vendored runtime (`viz create --local --runtime`)

`--runtime` vendors a self-contained runtime into `<repo>/viz-pages/.runtime/` (the serve
core + `kit/`, committed with the host repo), so a cloner can serve the repo's vizzes live,
`api.ts` and all, with no skill installed. It serves only that repo, uses repo-relative URLs
(`/viz-pages/<slug>/`), and walks up from port 5180 if it's taken. Generated content —
never hand-edit it.

**Opt-in on purpose.** Ask for it only when someone will genuinely clone the repo and run
its vizzes without the skill — in practice, when the repo's own docs tell a reader to. For
your own machine, registration alone is enough. It used to be implicit on every `--local`
run; an audit found **ten** repos carrying a runtime copy, only **two** of which used it.

**Staleness is handled for you.** The central server re-stamps every `.runtime/` under a
registered container on each start (including the 04:00 launchd restart), so a copy is at
most a day behind. `viz sync-runtimes` does the same sweep by hand — refresh only, never
creates one, and checks each copy still boots. It doesn't touch git: read the diff and
commit it in each repo. It's deliberately not its own scheduled job: a failed cron job is
silent, whereas a failed viz server is loud.

## Driving it from a chat app

Claude Desktop has no shell, but it runs local MCP servers as ordinary host processes.
`mcp.ts` is that server, and its `viz_*` tools are generated from the same command tree as
the CLI, so every verb is reachable and neither surface can drift from the other;
`viz_read` can return images, including the verify screenshots in `.verify/`. It ships as a one-click
`.mcpb` bundle with Bun inside (the self-portrait's install guide has the download).
ChatGPT desktop needs none of this: it is the Codex app, so the `npx skills` install runs in
full mode there (Work mode or the Codex side — Chat mode does not load local skills).
