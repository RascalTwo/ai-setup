# herdr-autolabel

A Claude Code `Stop` hook that keeps the herdr tab named after whatever the
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
`~/.claude/herdr-autolabel/<tab-id>`. On each turn the hook renames only if the
current label is auto-numbered *or* exactly the slug it set last time. Rename a
tab by hand and this backs off that tab permanently.

**Hysteresis is the model's job, not a heuristic.** The current slug goes into
the prompt with "if the conversation is still about the same thing, reply with
exactly the current slug." Without that, the same session gets renamed every
turn — `tcc-fix`, `ghostty-fda`, `mac-privacy` — for one piece of work. With it,
only a real pivot moves the name.

## Model

`qwen2.5-coder:7b`, overridable with `$HERDR_AUTOLABEL_MODEL`. Loaded with
`--keepalive 2m`, so it stays resident during a working burst and unloads when
you stop.

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
- **The status glyph is herdr's job.** Claude's title prefix (`✳` idle,
  `◐◑◒◓` working) is deliberately not carried over — the sidebar already shows
  status as a colored dot, and those columns are better spent on the name.
