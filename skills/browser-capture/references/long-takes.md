# Long choreographed takes

Read before recording anything longer than ~10 seconds. These lessons came from a nine-beat, 3:26 single-take recording shot five times; the recorder then was a MediaRecorder rig in claude-in-chrome, so the browse-specific parts below are re-derived for `browse recording`.

## Contents
- First: can the page seek? Then do not record in real time at all
- Keep the choreography in a file
- Timeouts
- Trim from the recording's own clock
- Assert on geometry, never on "the action returned"
- Verify a re-record structurally, not by eye
- A take that mutates data needs a restore and a reload

---

## First: can the page seek? Then do not record in real time at all.

Check before reading further:

```js
typeof window.__viz?.goTo === 'function'   // or any seek/scrub API the page exposes
```

If yes, **none of the rest of this page applies.** Drive the seek function frame by frame and pipe screenshots into ffmpeg: no trimming, no re-shoots, frame-accurate by construction, headless and unattended. The loop needs a process that can pipe into ffmpeg, so run it from a puppeteer or playwright script that launches its own browser (browse's script sandbox cannot spawn ffmpeg).

```js
for (let i = 0; i < total; i++) {
  await page.evaluate(`window.__viz.goTo(${(i / FPS).toFixed(4)})`);
  const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
}
```

Real-time recording drifts against the page's own clock: a 7-minute explainer drifted **+21.7s (+5.2%)** (measured with the old MediaRecorder recorder), so narration timings in the file no longer matched. Seeking produced a file exact to the millisecond. Full recipe and gotchas (kill `EventSource`, hide the comment overlay): `viz` skill, `reference/timeline.md`. If the page cannot seek and you own it, teaching it to is usually cheaper than a fifth take.

Everything below is for pages you cannot make seekable: third-party apps, real user sessions, anything where the motion is not yours to drive.

---

## Keep the choreography in a file

Write the flow to `flow.js` and run it with `browse execute -s <name> --file flow.js`. A script that existed only as a command-line string is gone with the session, and a re-take then starts from memory. Save the file next to the recording in `~/.agents/state/browser/<task>/`.

## Timeouts

`browse execute` stops a script at `--timeout-ms` (default 60000; `0` disables). A three-minute take needs `--timeout-ms 240000`, or one script per beat with the recording left running between them. `browse recording start` stops itself after `--max-duration-ms` (default 900000, 15 minutes). Per-action timeouts (`{ timeout: 5000 }`) still apply inside, so a missing selector fails in 5 s rather than hanging the take.

## Trim from the recording's own clock

`browse recording start --json` returns `startedAt` (epoch ms). Stamp `Date.now()` inside the script at the first beat and again at the last, and the cut points follow:

```js
const beatsStart = Date.now();
// ...beats...
await page.waitForTimeout(600);
const beatsEnd = Date.now();
return { beatsStart, beatsEnd };
```

```bash
# head = (beatsStart - startedAt)/1000 ; dur = (beatsEnd - beatsStart)/1000
ffmpeg -y -ss <head> -t <dur> -i take.mp4 -vf "scale=1920:-2" -r 30 \
  -movflags faststart -pix_fmt yuv420p -crf 21 -an out.mp4
```

Checked on a 3.9 s take: the stamp said the first change happened 2.2 s in, and `ffmpeg -vf mpdecimate,showinfo` put the first changed frame at 2.25 s. Cross-check the head the same way on any take that matters: dead air before the first beat is static, so the first changed frame marks it. Stamp `beatsEnd` before any closing hold so the cut lands on the last frame of action.

## Assert on geometry, never on "the action returned"

A drag that does nothing is indistinguishable from one that works: the handle is there, the wait resolves, nothing throws, and the element's rect comes back byte-identical. Measure before and after:

```js
const before = await el.boundingBox();
await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 20 }); await page.mouse.up();
const after = await el.boundingBox();   // if these match, the gesture was a no-op
```

## Verify a re-record structurally, not by eye

Scene-change detection is a cheap fingerprint of a take. If two takes produce the same number of cuts in the same order within a few tenths of a second, nothing was skipped, doubled or knocked off course, and any narration timings still hold:

```bash
ffmpeg -i take.mp4 -vf "select='gt(scene,0.35)',showinfo" -f null - 2>&1 \
  | grep showinfo | sed -E 's/.*pts_time:([0-9.]+).*/\1/'
```

## A take that mutates data needs a restore and a reload

Restoring the database while the page stays open leaves the client's query cache serving the old list, so the next take opens on stale rows. A focus event does not invalidate it: `page.reload()` before recording. For a local-storage app, clear it (`page.evaluate(() => localStorage.clear())`) and reload; `example.cypress.io/todo` keeps added todos across reloads until you do.
