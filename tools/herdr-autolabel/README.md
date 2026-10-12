---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    claude-code: [Stop]
    codex: [Stop]
    herdr: tab rename
  requires:
    commands: [herdr, ollama]
---

# herdr-autolabel

A `Stop` hook for Claude Code and Codex that keeps the herdr tab named after whatever the
conversation is about **right now**. Tabs stop being `6 · 7 · 8 · 9 · 10`.

Claude Code already writes a session summary into the terminal title, but that
title is set from the opening exchange and then frozen — no good for a label
meant to track a session that wanders. So the input here is the transcript, not
the title, and the last three user messages carry the topic.

## Flow

1. **Bail early if there's nothing to rename.** No `$HERDR_TAB_ID` (not inside
   herdr), no `herdr`, or no `ollama` → exit before waking any model.
2. Read `transcript_path` from the hook payload on stdin.
3. **Detach.** Everything past this point is a model call; a `Stop` hook that
   blocks is one you feel on every single turn.
4. Refuse to touch a human-typed name (see below).
5. Feed the model the first user message (topic anchor) + the last three
   (recency), plus the current slug.
6. Sanitize hard, then `herdr tab rename`.

## The two rules that make it livable

**Never fight a manual rename.** The slug we set is remembered in
`~/.agents/state/herdr-autolabel/<tab-id>`. On each turn the hook renames only if the
current label is auto-numbered *or* exactly the slug it set last time. Rename a
tab by hand and this backs off that tab permanently.

**Hysteresis is the model's job, not a heuristic.** The current slug goes into
the prompt with "if the conversation is still about the same thing, reply with
exactly the current slug." Without that, the same session gets renamed every
turn — `tcc-fix`, `ghostty-fda`, `mac-privacy` — for one piece of work. With it,
only a real pivot moves the name.

## Model

`qwen2.5-coder:7b`, overridable with `$HERDR_AUTOLABEL_MODEL`. Called through
the Ollama API with `keep_alive: 2m`, so it stays resident during a working
burst and unloads when you stop. The prompt is ~400 tokens, so it asks for
`num_ctx: 2048` (4.6 GB resident, vs 6.6 GB at the server's 32k default).

It skips the turn when Ollama holds some other model and this one is not
already loaded, so it never loads itself beside a big local model. If its own
model is already warm it runs regardless.

Chosen by bake-off on real transcripts, not vibes:

| Model | Session about CSS bugs | About an OpenAPI spec | This session |
|---|---|---|---|
| `qwen2.5:0.5b` | `viz-sai-chan` | `1-2-words-ra` ⚠️ | `terminal-ses` |
| `qwen2.5-coder:7b` | `css-bug-fixing` | `openapi-spec` | `terminal-tab` |

0.5b echoed the instructions back as the answer. Don't go below 7b without
re-running the bake-off.

## Gotchas

- **Small models pad, quote, capitalize, and explain.** Output is forced through
  first-line-only → lowercase → `[a-z0-9-]` → trim.
- **They also ignore the length limit.** ~2 of 3 answers overshot 12 chars, so
  the cut falls back to the last word boundary rather than shipping
  `css-bug-fixi`.
- **Label width is the real constraint.** The sidebar is kept deliberately
  narrow, which leaves roughly 10 columns for the label — a 12-char name like
  `backstage-io` renders as `backstage…`. `LIMIT` is 12 to match the
  hand-written names it sits beside; the occasional ellipsis is accepted.
  Widening via `sidebar_width` (max 36) is available but not wanted here.
- **Row 1 is one token on purpose; row 2 is the statusline metrics.** Stock herdr hardcodes ` · `
  between sidebar tokens and indents rows 1 / 3 columns (`src/ui/sidebar/tokens.rs`,
  `src/client/shell/agent_sidebar.rs`; a request to configure them is herdrdev/herdr discussion
  #2047, open — issue #2045 was closed as belonging in Discussions). So this setup runs the
  **RascalTwo/herdr fork** (`~/Desktop/Desktop/Code/herdr`, see its `FORK.md`), which adds
  `separator`, `indent` and `continuation_indent` to `[ui.sidebar.agents]`; `herdr-sidebar.toml`
  sets them to a plain space and zero. Row 1 is `["state_icon", "tab"]`; names that overflow are
  truncated with `…`, herdr has no wrap. Row 2 (context used, cache countdown) is reported by the
  statusline widgets — see `tools/statusline/README.md`. On stock herdr the three keys are ignored
  with a warning and row 2 reads `161k · 60m`, indented 3.
- **Codex** runs the same script as `herdr-autolabel codex`, registered in
  `~/.codex/config.toml` by `install.ts`; only the transcript shape differs.
- **The status glyph is herdr's job.** Claude's title prefix (`✳` idle,
  `◐◑◒◓` working) is deliberately not carried over — the sidebar already shows
  status as a colored dot, and those columns are better spent on the name.

## Agents list: only this Space

`herdr-plugin/` is a herdr plugin with one startup hook, `space-view`, which sets the Agent view
"workspace = the Space you're looking at" (`agent.view.set`). herdr keeps an Agent view in memory
only, so the hook sets it again whenever a herdr server starts. Linked with
`herdr plugin link tools/herdr-autolabel/herdr-plugin`; run `herdr-plugin/space-view` by hand to
set it now. `herdr-sidebar.toml` also drops the Spaces sidebar's branch row, so each Space is one line.
