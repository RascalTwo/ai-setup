# Operations & system internals

Look-it-up commands for managing the server and viz history, plus the discovery and repo-local-runtime mechanics. None of this is needed to *author* a viz — reach for it when you're managing, debugging, or shipping the system itself.

## Managing vizzes and the server

- **Browse all viz pages**: visit `http://127.0.0.1:5180/` — it redirects to the self-portrait home page, which lists every viz (central + repo-local) with live stats and a **Rescan** button. Falls back to a plain listing if the self-portrait is absent.
- **Per-viz history**: central — `cd "$VIZ" && git log -- <slug>/`; repo-local — `cd <host-repo> && git log -- viz-pages/<slug>/`.
- **Rollback**: central — `cd "$VIZ" && git checkout <hash> -- <slug>/`; repo-local — the same `git checkout` in the host repo. Browser auto-reloads either way.
- **Stop the server**: portable — `kill $(cat "$VIZ/.server.pid")` (works in bash and Git Bash). Unix shortcut: `pkill -f viz/server.ts`. Windows (PowerShell): `Stop-Process -Id (Get-Content "$env:VIZ_PAGES_DIR\.server.pid")` (or the resolved `$VIZ` path). Logs at `$VIZ/.server.log`.

## Discovery of repo-local vizzes

Automatic: on startup (and on demand via a Rescan button / `curl http://127.0.0.1:5180/_rescan`) the server deep-scans your home directory for `viz-pages/` folders, caching what it finds in an uncommitted, machine-local registry (`$VIZ/.discovered.json`). Creating a repo-local viz also registers it immediately, so it's visible without waiting for a scan.

## Standalone vendored runtime (repo-local `--local`)

`--local` vendors a self-contained runtime into `<repo>/viz-pages/.runtime/` (the serve core + `kit/`, committed with the host repo). This makes the repo's vizzes **independently runnable with no skill installed** — clone the repo and `bun viz-pages/.runtime/server.ts` serves them live, `api.ts` and all.

It's the **same server code** as central, self-detecting "standalone" from its `.runtime/` location: it serves only that repo, scans only that repo (never a cloner's `$HOME`), gives vizzes repo-relative URLs (`/viz-pages/<slug>/`), and walks up from port 5180 if it's taken. Every `--local` run re-stamps `.runtime/` from the skill's canonical copy (it's generated, git-tracked content — never hand-edit it). The dot-prefix keeps central discovery from mistaking it for a viz.
