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
window.__viz = {
  total: 430,              // seconds, declared — not emergent from timers
  goTo(t) { … },           // render the exact state at t. Must be idempotent.
  pause() { … },
  play()  { … },
  at: () => t,             // current playhead
  // optional, and they pay for themselves — see below
  chapters: [{ n, title, t0, dur }],
  beats:    [{ ci, t0, dur }],
};
```

`total` + `goTo` + `pause` is the minimum. The rest is optional.

Leave the existing `window.__vizPause()` / `window.__vizResume()` free functions
alone if you have them — the comment overlay calls those, and they are documented
in `review-layer.md`. They are not this contract.

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
- **the comment layer** — a pin's `vizState` only reproduces if the film can be
  put back exactly where the user was standing when they left it

## Capturing to video

Do not screen-record a seekable film. Drive `goTo()` frame by frame and pipe
screenshots straight into ffmpeg — the file is frame-accurate by construction,
it runs headless, and it is unattended.

Working reference implementation, ~60 lines, which produced an exactly-430.000s
video from a 430s film.

(It predates this contract and calls the free functions `__vizSeek()` /
`__vizDuration()` rather than `__viz.goTo()` / `__viz.total`. Same mechanism,
older names.)

The shape:

```js
await page.waitForFunction('!!window.__viz');
await page.evaluate('window.__viz.pause()');
const total = Math.round(await page.evaluate('window.__viz.total') * FPS);

const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(FPS),
  '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17',
  '-movflags', '+faststart', OUT], { stdio: ['pipe', 'ignore', 'ignore'] });

for (let i = 0; i < total; i++) {
  await page.evaluate(`window.__viz.goTo(${(i / FPS).toFixed(4)})`);
  const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
}
```

Two things that will bite:

- **Stub `WebSocket` before navigating** (`page.evaluateOnNewDocument`) or the
  dev server's hot reload navigates away mid-capture. The reload client holds its
  socket in a closure, so there's nothing to call `.close()` on from outside —
  replace the constructor instead: `window.WebSocket = function(){ return {} }`.
  (It was `EventSource` until the channel moved to websockets; see kit/reload.ts.)
- **Hide the comment overlay** (`#viz-comments{display:none!important}`) — it is
  server chrome, not part of the piece.

Puppeteer is already vendored at `$VIZ_SKILL_DIR/node_modules/puppeteer-core`;
no install needed.

## Check it before you ship

One line, and it fails loudly if the contract is broken:

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 out.mp4
# must equal window.__viz.total. If it doesn't, goTo() isn't idempotent —
# something is accumulating state across seeks instead of rebuilding.
```
