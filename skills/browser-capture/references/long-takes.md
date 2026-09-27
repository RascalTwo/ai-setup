# Long choreographed takes

Read before recording anything longer than a few seconds.

A ten-second clip and a three-minute continuous take are different jobs. Everything below came
out of a nine-beat, 3:26 single-take recording that was shot five times; none of it shows up at
ten seconds.

---

## First: can the page seek? Then don't record in real time at all.

Check before reading further:

```js
typeof window.__viz?.goTo === 'function'   // or any seek/scrub API the page exposes
```

If yes, **none of the rest of this page applies.** Drive the seek function frame by frame and
pipe screenshots into ffmpeg. No clapper, no trimming, no `freezedetect` cross-check, no 45s
CDP chunking, no re-shoots — the capture is frame-accurate by construction and runs headless
and unattended.

```js
for (let i = 0; i < total; i++) {
  await page.evaluate(`window.__viz.goTo(${(i / FPS).toFixed(4)})`);
  const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
  if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
}
```

This matters more the longer the take. Measured on a 7-minute explainer: the real-time take
drifted **+21.7s (+5.2%)** against the page's own clock — roughly linear, already 11s of lag by
the 4-minute mark — so the narration timings in the file no longer matched the page. Seeking
produced a file exact to the millisecond. Full recipe and the gotchas (kill `EventSource`, hide
the comment overlay): `viz` skill → `reference/timeline.md`.

If the page *can't* seek and you own it, teaching it to is usually cheaper than a fifth take.

Everything below is for pages you cannot make seekable — third-party apps, real user sessions,
anything where the motion isn't yours to drive.

---

**Keep the rig in a FILE, and re-inject from it.** A rig that only ever existed as
`javascript_tool` payloads is unrecoverable once the session ends — recovering one meant
grepping `~/.claude/projects/*.jsonl` for tool-call payloads. The rig does not survive a page
load, so re-injection has to be cheap. With Vite it is two lines:

```js
window.__rigPath = '/@fs/<abs path>/rig.js';
window.__inject = async () => (0, eval)((await import(window.__rigPath + '?raw&t=' + Date.now())).default);
await window.__inject();
```

**`?raw` is load-bearing** — without it Vite returns the *transformed* module (110KB of HMR
wrapper around a 17KB file). `t=` busts the module cache so an edit actually takes. This works
**cross-origin too** (`http://localhost:5173/@fs/…` from a page on `:5174`) because Vite dev
ships CORS on — which is how one rig drives two different apps.

**Gate the choreography; never fire it in the call that checks `state`.** Approving capture and
parking the pointer take seconds to tens of seconds, and every beat that runs first is lost.
Queue the beats behind a loop that waits for both conditions:

```js
while (__cap.state !== 'RECORDING') await sleep(120);
__cap.park();                                  // then click the returned coords
while (!__cap.parked) await sleep(120);
await __narrate.clap();  __t.beatsStart = performance.now();
for (const name of BEATS) { await beats[name](); }
await sleep(600);   __t.beatsEnd = performance.now();  await __narrate.clap();
```

**Trim from the recorder's own clock, and cross-check with ffmpeg.** `cap.t0` is stamped inside
`start()`, so `(beatsStart - cap.t0) / 1000` is the head cut and `beatsEnd - beatsStart` the
duration. Stamp `beatsEnd` **before** the closing clap so the cut lands on the last frame of
action rather than on two white frames.

```bash
ffmpeg -y -ss <head> -t <dur> -i take.webm -vf "scale=1920:-2" -r 30 \
  -movflags faststart -pix_fmt yuv420p -crf 21 -an out.mp4
# cross-check the head: front dead air is static, so freezedetect finds first motion
ffmpeg -t 30 -i take.webm -vf "scale=240:-1,freezedetect=n=0.003:d=1.0" -map 0:v -f null - 2>&1 | grep freeze_end
```

The two agreed within 0.2s across takes. **Don't rely on the clapper alone on a white-background
app** — the flash barely differs from the page.

**Assert on geometry, never on "the action returned".** This is the one that cost the most. A
drag that does *nothing* is indistinguishable from a drag that works: the handle is really
there, `waitFor` resolves, no error is thrown, and the element's rect comes back
**byte-identical**. It survived several takes and was only caught by measuring:

```js
const before = el.getBoundingClientRect();
await __narrate.drag(handle, dx, dy);
const after = el.getBoundingClientRect();   // if these match, the gesture was a no-op
```

**Poll in chunks under 40 seconds.** CDP `Runtime.evaluate` times out at 45s, so a single
`await` spanning a three-minute take always fails. Loop `for (i<35) { sleep(1000) }` and re-issue.

**Verify a re-record structurally, not by eye.** Scene-change detection gives a cheap fingerprint
of a take — if two takes produce the same number of cuts in the same order within a few tenths
of a second, nothing was skipped, doubled or knocked off course, and any narration timings still
hold:

```bash
ffmpeg -i take.mp4 -vf "select='gt(scene,0.35)',showinfo" -f null - 2>&1 \
  | grep showinfo | sed -E 's/.*pts_time:([0-9.]+).*/\1/'
```

**A take that mutates data needs a restore *and* a reload.** Restoring the database while the
page stays open leaves the client's query cache serving the old list, so the next take opens on
stale rows. `dispatchEvent(new Event('focus'))` does not invalidate it — hard reload, then
re-inject.

---

