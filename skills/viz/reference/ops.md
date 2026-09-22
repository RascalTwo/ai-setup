# Operations & system internals

Look-it-up commands for managing the server and viz history, plus the discovery and repo-local-runtime mechanics. None of this is needed to *author* a viz — reach for it when you're managing, debugging, or shipping the system itself.

## Managing vizzes and the server

All of these are `manage.ts` verbs rather than raw git/curl/kill one-liners, so
the CLI, an agent, and the MCP server (`mcp.ts`) all reach one implementation.

- **Browse all viz pages**: visit `http://127.0.0.1:5180/` — it redirects to the self-portrait home page, which lists every viz (central + repo-local) with live stats and a **Rescan** button. Falls back to a plain listing if the self-portrait is absent.
- **Per-viz history**: `viz history <viz-folder> [--n <count>]`. Works for central and repo-local alike — it finds whichever repo contains the viz and logs that path.
- **Rollback**: `viz rollback <viz-folder> <commit-hash>` — restores that viz to an earlier commit and commits the restore (`--no-commit` to skip). Browser auto-reloads.
- **The server**: `viz server start | stop | status | rescan`, all `--json`-able.
  `status` answers whether it's up, on which port and pid — there used to be no way to ask. `start` is
  idempotent and is what `bootstrap.ts` calls, so minting a viz is no longer the only way to get a server.
  `rescan` re-registers repo-local vizzes without waiting for a restart. Logs at `$VIZ/.server.log`.
- **Keep it running across logins (macOS, optional)**: the server is lazy-spawned by `bootstrap.ts`, so nothing needs supervising — but two launchd agents in `launchd/` will keep it alive and restart it nightly if you want that. Install steps, and why the plists ship with a placeholder username: `launchd/README.md`. If you install them, `kill`ing the server just makes launchd restart it — `launchctl bootout` first.

## Discovery of repo-local vizzes

Automatic: on startup (and on demand via a Rescan button / `curl http://127.0.0.1:5180/_rescan`) the server deep-scans your home directory for `viz-pages/` folders, caching what it finds in an uncommitted, machine-local registry (`$VIZ/.discovered.json`). Creating a repo-local viz also registers it immediately, so it's visible without waiting for a scan.

## Standalone vendored runtime (repo-local `--local`)

`--local --runtime` vendors a self-contained runtime into `<repo>/viz-pages/.runtime/` (the serve core + `kit/`, committed with the host repo). This makes the repo's vizzes **independently runnable with no skill installed** — clone the repo and `bun viz-pages/.runtime/server.ts` serves them live, `api.ts` and all.

`--runtime` is **opt-in** (it was implicit on every `--local` run until 2026-08-17). Only ask for it when someone will genuinely clone the repo and run its vizzes without the skill — in practice, when the repo's own committed docs tell a reader to run it. For your own machine, registration alone is enough: the central server serves every discovered container already.

That reversal was evidence-driven, which is why the default is what it is: implicit vendoring had put a committed copy of the whole serve runtime into **ten** repos, and an audit found **two** where the standalone property was actually used against **eight** carrying tracked files nothing read, silently drifting from canonical.

**You should never need to run this by hand: the central server sweeps on startup.** It runs on every server start — including the 04:00 launchd restart — so a runtime is at most a day behind, and re-stamping is free when nothing moved. Deliberately *not* its own scheduled job: a cron/launchd job fails silently (this repo's own server job sat dead on exit 78 for weeks while its restart job kickstarted a corpse), whereas the viz server failing is loud — your vizzes stop loading. Standalone servers never sweep. Output lands in `/tmp/viz-server.log`.

**Manual sweep: `viz sync-runtimes [--dry-run]`.** A vendored runtime is a copy, so it goes stale the moment the skill moves and nothing tells you. The sweeper re-stamps every `.runtime/` under a registered container — **refresh only, it never creates one**, because the `--runtime` opt-in is the decision about whether a repo needs one. It refuses to run if the skill's own `server.ts` doesn't resolve, and checks each stamped copy boots, because a runtime that won't start is worse than a stale one that does. It doesn't touch git: every target is somebody's repo, so read the diff and commit it there.

It's the **same server code** as central, self-detecting "standalone" from its `.runtime/` location: it serves only that repo, scans only that repo (never a cloner's `$HOME`), gives vizzes repo-relative URLs (`/viz-pages/<slug>/`), and walks up from port 5180 if it's taken. Every `--runtime` run re-stamps `.runtime/` from the skill's canonical copy (it's generated, git-tracked content — never hand-edit it). The dot-prefix keeps central discovery from mistaking it for a viz.
