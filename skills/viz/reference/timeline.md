# Timed films — the seek contract

Read this when the viz is a **film**: it has a duration, it plays, and the user
will want a video file out of it. Not for ambient motion or hover transitions —
those need nothing from this page.

## The one rule

**A film must be able to render any moment on demand, without having played up
to it.** Expose that, and everything else on this page is free. Skip it, and a
long piece costs you a real-time take per iteration and a video that no longer
matches the page.

Measured on a 7-minute explainer: a wall-clock take drifted **+21.7s (+5.2%)**
against the page's own clock, accumulating roughly linearly — 11s of lag by the
4-minute mark. The same piece captured by seeking came out exact to the
millisecond.

## The contract

```js
window.__viz = window.__viz || {};   // a namespace — other contracts live beside this one
window.__viz.timeline = {
  total: 430,              // seconds, declared — not emergent from timers
  seek(t) { … },           // render the exact state at t. Must be idempotent.
  pause() { … },
  play()  { … },
  at: () => t,             // current playhead
  // optional, and they pay for themselves — see below
  chapters: [{ n, title, t0, dur }],
  beats:    [{ ci, t0, dur }],
};
```

`total` + `seek` + `pause` is the minimum. The rest is optional. (`seek` was `goTo`, and
the object was `window.__viz` itself, before any viz used it — both renamed so `__viz`
can hold more than one contract.)

Leave the existing `window.__vizPause()` / `window.__vizResume()` free functions
alone if you have them — the feedback widget calls those, and they are documented
in `review-layer.md`. They are not this contract.

## The fast path: `film()` from the kit

For a narrated explainer, don't hand-roll the contract — `/_kit/film.js` is one:

```html
<div id="stage">
  <section class="scene" data-title="The problem" data-beats="1-4">
    <div data-b="2" data-d="0.5">appears half a second into beat 2</div>
  </section>
</div>
<script type="module">
  import { film } from "/_kit/film.js";
  await film();   // registers window.__viz.timeline, draws the chapter bar, wires narration
</script>
```

- A fixed 1920×1080 stage, scaled to the window; scenes are chapters.
- **Beats time themselves from `narration.json`**: each lasts as long as its compiled line
  plus a breath, so the picture waits for the voice. The first `viz verify` compiles the
  clips; the second picks up their real lengths (before that, it estimates from word count).
- `data-b="N"` fades an element in at beat N (`data-d` delays it, `data-x="M"` fades it out
  at beat M); `data-fx="N"` drives `--q` 0→1 for an effect. Animate with `var(--p)` /
  `var(--q)` in CSS — never a CSS transition, so a rendered frame is as smooth as playback.
- `f.setCursor([{ t, until, x, y }])` — a cursor (ui-narration's arrow, its 950ms glide) that
  glides to stage point (x, y) at t and stays until `until`; consecutive points glide. Aim at
  the centre of the target, and don't also highlight the same thing — point or light, not both.
- A chapter bar (segment width = chapter length) that renders, and play/scrub controls
  that don't (`data-viz-chrome`). `<section data-zoom style="--z:1.25">` enlarges a sparse scene.

`viz verify` on any timed page writes **`.verify/chapters.png`: the last frame of every
chapter, tiled.** Read it — it is the whole film at a glance, and where overflow shows.

**Add `<meta name="viz:film">` to the page's `<head>`.** A film's module registers the timeline
after its own setup (fetches, a highlighter), and `viz verify` / `viz render` can't tell
"still loading" from "not a film" — the meta tells them to wait for it instead of rendering a
best-effort, timeline-less video.

The rest of this page explains the contract underneath, for a film `film()` doesn't fit.

## You do not need a time-interpolation engine for this

The obvious implementation is "every property is a pure function of `t`". It
works, and it is not required. The approach that beat it in a head-to-head was
simpler: **a flat list of beats, each mutating the stage, with CSS transitions
doing the interpolation.** To seek, rebuild the stage and replay every beat up to
`t` with transitions switched off, then switch them back on.

That inversion buys three things from one mechanism:

- seeking works, because replay is deterministic
- `prefers-reduced-motion` is the *same code path* — it is just "transitions off,
  permanently"
- no animation library, no build step, no React

Do not reach for a declarative `f(t)` engine unless a beat list genuinely cannot
express the piece. It usually can.

## Why the optional members pay for themselves

`chapters[]` and `beats[]` with `t0`/`dur` cost a few lines and give you:

- **verification** — seek to `chapters.map(c => c.t0)` and screenshot each; you
  are checking the moments that matter rather than arbitrary timestamps
- **deep links** — a chapter is addressable, which is what makes `#t=182.4` or
  the existing `#act=N&beat=M` reproduce a real state
- **the feedback widget** — a line's saved `#hash` only reproduces if the film can be
  put back exactly where the user was standing when they left it

## Capturing to video — `viz render`

```bash
viz render start <viz> --wait          # 1920x1080@30 → an mp4 in the job's temp dir
viz render start <viz> --out talk.mp4  # returns a job id at once; poll it:
viz render status <id> [--wait]        # progress, output path, warnings
viz render cancel <id>
```

It never screen-records. It calls `seek(t)` frame by frame in headless Chrome and pipes
the shots into ffmpeg, so the file is frame-accurate by construction and nothing waits
on the wall clock. Because every frame stands alone, it splits the frames across
`--workers` browsers (default: a few) and joins the slices losslessly. It checks one
frame at each join; if `seek()` carries state between calls, it warns that the seams
may glitch — fix `seek()`, or render with `--workers 1`.

A render is a background job on every surface (CLI, MCP, the dashboard's drawer), so a
long film never blocks anything. Data behaves exactly like viewing: live, or the tape
with `--frozen` (the server must be in frozen mode — no silent fallback, ADR 0003).
The film's chapters become the mp4's own chapters (QuickTime, VLC and IINA list and skip them),
and `<out>.chapters.txt` holds them as `0:00 Title` lines — paste into a YouTube description.

It hides the feedback widget, the reload badge and on-page captions — and anything the page
marks `data-viz-chrome` (put it on your play/scrub controls; the video shouldn't show them).

**No timeline?** It still renders, best-effort: every CSS/Web Animation is frozen at each
frame, and the length is the longest finite animation (`--duration` when something
loops forever). JavaScript-driven motion — rAF loops, canvas — can't be reached that
way; it is detected and warned about. For an exact render, expose the contract.

## Narration and captions

Script it in the viz — `narration.json` beside `index.html`, your own files in `audio/`:

```json
{ "voice": "af_heart", "speed": 1.0,
  "cues": [
    { "at": "chapter:2", "say": "Now the token comes back…" },
    { "at": "beat:7",    "audio": "audio/whoosh.mp3", "gain": -6 },
    { "at": 0,           "audio": "audio/music.mp3",  "gain": -18 },
    { "at": 12.5,        "audio": "audio/me.m4a",     "caption": true } ] }
```

- `at` — `"chapter:N"` (a chapter's `n`), `"beat:N"` (1-based position in `beats`), or seconds.
- `say` — spoken by Kokoro (local, `127.0.0.1:8880`; `VIZ_KOKORO_URL` moves it). `voice`
  and `speed` (0.5–2.0) are global with a per-cue override. Nothing else is supported.
- `audio` — any file under the viz. `gain` is dB; there is no auto-ducking, so set music
  under speech yourself. `"caption": true` transcribes it (mlx_whisper) — for a real
  voiceover, never for music.

`viz verify` compiles it: synthesizes missing clips into `.tts/` (build output — it
ignores itself in git), measures each, and **warns when a line outlasts its chapter or
beat** (`narration runs 6.10s but it has 4.00s — needs +2.10s`) or two lines overlap.
Fix it however reads best: shorten the line, raise `speed`, or lengthen the beat.

To hear it in the page, call the kit's `narrate()` once after registering the timeline:

```js
import { narrate } from "/_kit/viz.js";
narrate(window.__viz.timeline);   // plays cues in sync; CC toggle (key: c) for captions
```

`viz render` mixes the same clips into the mp4 and adds the captions as a subtitle track
players can toggle, plus a sidecar `.vtt`. Captions are never burned into the picture.
`viz publish` / `export` inline the compiled clips, so narration works on a static host.

## Check it before you ship

`viz render` reports the frame count it rendered; to double-check a file:

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 out.mp4
# must equal window.__viz.timeline.total
```
