# /viz — live ad-hoc visualizations for AI coding agents

Render arbitrary HTML/CSS/JS — charts, graphs, 3D scenes, state machines, dashboards, animated
explainers, custom UIs — and serve it at a live, **hot-reloading** local URL, with per-page git
history and optional Bun backends for live data. It's the skill you point your assistant at when
you want to *see* something, not read a wall of text about it.

`/viz` is an [Agent Skill](https://agentskills.io): a `SKILL.md` manual plus a small
[Bun](https://bun.sh) toolchain. It runs in any agent that speaks the format — Claude Code,
OpenAI Codex, GitHub Copilot, Cursor, Gemini Antigravity/CLI, and others.

## Install

```bash
npx skills add RascalTwo/explorables
```

That's [Vercel's `skills` CLI](https://github.com/vercel-labs/skills): it detects whichever
agents you have installed and drops `/viz` into each one's skills directory. Then, in your agent:

```
/viz a force-directed graph of this repo's imports, edges weighted by call count
```

**Requirements:** [Bun](https://bun.sh) (`bun --version` should work). On the first render the
verify step runs `bun install` once to pull `puppeteer-core` — it drives your existing Chrome, so
there's no Chromium download.

Prefer not to run a third-party `npx`? The skill is just the `skills/viz/` folder — clone the repo
and copy or symlink it into your agent's skills dir by hand (see **Develop** below); everything the
skill needs lives inside that one folder.

## Update

```bash
npx skills update
```

Re-pulls the latest `/viz` across all your agents. It's **manual** — run it when you want the
newest version. (There's no baked-in `version` to bump; `skills` tracks the folder's content, so
any change I publish shows up as an available update.)

## What you get

- Any spatial form HTML + JS can express, served at a hot-reloading `127.0.0.1:5180` URL
- Per-viz git history and rollback, plus an Alt/Option-click **review-comment layer** to hand the
  agent located visual feedback
- A shared **kit** (`/_kit/`) of dark-theme tokens, chrome, and SVG-diagram helpers so vizzes look
  like one system instead of re-deriving the same hexes every time
- Optional per-page Bun **`api.ts`** for live data (shell/file reads), streamed over SSE, with a
  **tape recorder** so an api-backed viz still plays away from its data source
- One-command **publish** to any static host (self-contained HTML; optional StatiCrypt encryption
  for private/lobby-sealed pages)

Full manual — modes, the kit, backends, verify, publishing: [`SKILL.md`](./SKILL.md).

## Develop

The skill develops **in place** — no reinstall loop. Clone the repo and symlink `skills/viz/` into
your agent's skills dir, so edits are live on the next invocation:

```bash
git clone https://github.com/RascalTwo/explorables
ln -s "$PWD/explorables/skills/viz" ~/.claude/skills/viz   # or your agent's skills dir
```

`npx skills` ignores a hand-made symlink (it isn't in any lockfile), so the dev symlink and the
`skills`-managed world coexist. **One caveat:** don't `npx skills add` *this* skill **globally**
(`-g`) on your dev machine — it will replace the symlink with a frozen copy. To rehearse the real
consumer install/update flow, do it in a throwaway **project** dir instead:

```bash
mkdir /tmp/viz-consumer && cd /tmp/viz-consumer
npx skills add RascalTwo/explorables   # stays local (./.agents/skills/viz + skills-lock.json) — never touches your global symlink
npx skills update
rm -rf /tmp/viz-consumer               # done
```

## License

MIT — see [LICENSE](../../LICENSE).
