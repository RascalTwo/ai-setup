---
name: browser-capture
description: >-
  Get screenshots, animated GIFs, and smooth video OUT of a Chrome
  browser-automation (claude-in-chrome) session and onto disk, so they can be
  embedded into a doc, guide, PR, report, or artifact. Use this WHENEVER you
  need to save a shot of a web page or app to an image file, produce a
  click-by-click visual walkthrough or how-to of a web UI, record a GIF of a
  browser flow, or turn what you see in the browser into images inside
  Markdown/a PR/a report — even when the user only says something like "add
  screenshots of the steps", "show how to do X in the UI", or "record a
  walkthrough". Use it too when a GIF came out choppy, jumpy, or slideshow-like
  and someone wants SMOOTH video or a real screen recording of a browser flow:
  the automated Chrome is headless and physically cannot be screen-recorded, so
  this skill carries the only route that works (choreograph the flow, then hand
  the camera to the human). Reach for it as soon as browser visuals need to
  become files, because the obvious paths — the computer tool's save_to_disk
  flag, or "just take more screenshots to smooth out the GIF" — both silently
  fail.
---

# browser-capture

Turn a live Chrome browser-automation session into image or video files you can
embed. The non-obvious parts — and the reason this skill exists — are that the
direct "screenshot to disk" path is unreliable, and that **the GIF recorder can
never produce smooth motion no matter how hard you push it.** Knowing which of
the two routes below you're on, before you start, saves hours.

Assumes the `claude-in-chrome` browser tools are already connected and you can
drive the page (see the **claude-in-chrome** skill for connecting/navigating).
Dependency: **ffmpeg** (frame extraction, conversion, contact sheets). On macOS,
**sips** (`/usr/bin/sips`, built in) is handy for quick single-image work.

## Decide the route first

| What you need | Route | What you actually get |
|---|---|---|
| A click-by-click how-to; stills for a doc/PR/issue | **A — GIF recorder** | One frame per *action*, with click annotations. A **slideshow**. |
| Smooth motion — a real video of a flow | **B — hand the camera to the human** | A true screen recording at full frame rate. |

**The trap:** Route A cannot be turned into Route B by trying harder. `gif_creator`
captures one frame per *action* — so a five-step flow yields ~five frames, and
extra `screenshot` calls add **zero** frames (see below). Padding, re-recording,
and re-timing will not manufacture motion that was never captured. If someone
says the GIF looks "janky", "choppy", or "like a slideshow", that is not a
quality bug to iterate on — it's Route A working as designed, and it's the
signal to switch to Route B.

---

## The core gotcha (read this first, applies to both routes)

`mcp__claude-in-chrome__computer` with `action: screenshot` shows you the image
inline — great for *seeing* the page — but its `save_to_disk: true` flag often
returns only an image **ID and writes no findable file**. Don't build on the
assumption that it saved. If you ever do use it, **verify the file exists on disk
before continuing** (`ls` the expected path). Both routes below sidestep it
entirely by using a genuine *browser download* or a real screen recording, which
do land on disk.

---

# Route A — the GIF recorder (click-by-click how-tos)

The move is: **record the session as a GIF, download it, then rip stills out of
the GIF with ffmpeg.** One recording gives you both an animated walkthrough and
every still you need.

### 1. Record the walkthrough

```
gif_creator  action=start_recording
```

Then do the real work with `computer` (clicks, typing) and `navigate`. **Each
click and navigation becomes one GIF frame**, and the recorder draws
click-indicator circles + action labels on for free — which is exactly what makes
a good how-to.

A standalone `screenshot` action does **not** add a frame; frames come from
*actions*. This is the single most expensive misunderstanding available here —
it is genuinely tempting to think "the GIF is choppy, I'll take screenshots
between the clicks to smooth it out." That adds nothing but time. Drive the flow
by clicking through it for real, and accept the frame count you get.

### 2. Export as a download

```
gif_creator  action=export  download:true  filename="myflow.gif"
```

`download:true` triggers a browser download → the GIF lands in **`~/Downloads`**.
Useful `options`:

| Goal | options |
|---|---|
| How-to walkthrough (show where to click) | `showClickIndicators:true, showActionLabels:true, showWatermark:false, showProgressBar:false` |
| Cleaner / smaller | add `quality:8` (lower number = better quality, larger file) |

Export **clears the recording**, so if you have distinct phases (e.g. a "do it"
and an "undo it"), record and export each phase separately.

### 3. Rip stills out of the GIF

Every frame corresponds to one recorded action, so the stills you want are already
in the GIF:

```bash
# extract ALL frames as PNGs
ffmpeg -loglevel error -i ~/Downloads/myflow.gif frames/f-%02d.png

# build a contact sheet (thumbnail grid) to see which frame is which
ffmpeg -loglevel error -framerate 1 -pattern_type glob -i "frames/*.png" \
  -vf "scale=360:-1,tile=5x6" -frames:v 1 contact.png
```

`Read` the contact sheet, pick the few frames that show the meaningful states
(form filled, confirmation dialog, end state), and copy those into the target
repo/dir with **descriptive names** (`do-1-role-form.png`, not `f-08.png`). The
stills keep the click annotations, which is usually what you want for a how-to.

### 4. Embed and tidy up

Reference the images from your Markdown/PR with relative paths, then **clean the
scratch copies out of `~/Downloads`** (they're safely in the repo now). Keep the
total image weight sane — a handful of stills + one or two GIFs, not every frame.

---

# Route B — smooth video: you choreograph, the human films

### Why you cannot record it yourself

The Chrome you drive over MCP runs **`--headless=new`**. There is no on-screen
window. That single fact closes every automated video path, and it's worth
recognizing in the first minute rather than the second hour:

- **Screen capture records the wrong thing.** `ffmpeg -f avfoundation` grabs the
  *visible desktop* — whatever the human actually has open (Slack, the editor),
  never the headless browser. It will look like the tool is broken; it isn't.
- **Driving a separate, visible Chrome doesn't rescue it.** A fresh Playwright
  browser has none of the user's session, and lifting their auth token to
  re-authenticate is (rightly) blocked by security guardrails.

No window → nothing to film. This is an **environmental ceiling, not a skill
issue**, and no amount of cleverness gets under it. The correct move is to split
the work along the line where each party is actually capable.

### The pattern that works

**You choreograph and verify. The human runs the camera.** They have the one
thing you don't: a real, visible, already-logged-in browser on a screen that a
recorder can see.

1. **Write a self-running walkthrough script** (`walkthrough.js`) that performs
   the entire flow — see below.
2. **Validate it end-to-end in the headless browser you drive**, so you know it
   works before spending any of the human's attention.
3. **Hand off with a precise brief** (below). They open their own logged-in
   Chrome, run the script, and screen-record it — on macOS, QuickTime via
   **⌘⇧5**.
4. **They give you the file; you finish the job** — convert, re-time, and verify
   with ffmpeg/ffprobe. Confirm the output is real before declaring done:

```bash
ffprobe -v error -show_entries stream=nb_frames,width,height -of default=nw=1 recording.mov
ffmpeg -loglevel error -i recording.mov -vf "fps=15,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif
```

A healthy result has hundreds of frames, not five — that's the whole point of
Route B, and it's the cheapest way to confirm you're no longer looking at a
slideshow.

### Writing `walkthrough.js`

The script has to carry the visual story by itself, because the recorder only
captures what's on screen — there are no click annotations in Route B.

- **Inject your own cursor** and a highlight box (see the next section).
- **Tween with `requestAnimationFrame`**, not CSS transitions. A CSS transition
  lags behind whatever it's chasing, so the cursor and its click-ring visibly
  drift apart mid-glide. Drive position yourself, frame by frame.
- **Fire real clicks** (`el.click()`) so the app genuinely navigates — the point
  is a truthful recording, not a mime.
- **Insert timed pauses** so a viewer can actually read each state before it
  moves on. Recordings are watched by humans at human speed.
- **Keep it self-contained** — one paste into the console runs the whole flow
  start to finish. Anything requiring the human to intervene mid-take wastes
  takes.

### The hand-off brief

The human gets one shot per take, and a confused operator burns takes. Tell them,
concretely:

- **Which window/tab** to have focused, and how to tell it's the right one.
- **What they'll see when it starts** — e.g. *"a white arrow appears top-left,
  then ~5s later it starts moving."* This doubles as a **tell**: if their window
  sits dead still, they're recording the wrong one, and they know immediately
  instead of after a wasted minute.
- **How to start and stop** the recording, and where the file lands.

Then take the file back and finish it. The human's job ends at "here's the
recording" — don't leave them doing conversion or cropping.

---

## The injected cursor (improves both routes)

The recorder's built-in click indicators are on/off only, and can sit visibly off
from the real click. Injecting your **own** cursor into the page via
`javascript_tool` makes it part of the actual page pixels — so it's perfectly
aligned, styleable (a click-ring, a pulse, a press-dip), and it survives into a
GIF *and* into a screen recording.

The one gotcha worth knowing up front: **screenshot coordinates are not CSS
pixels.** Measure the scale factor once, bake it into your cursor helper, and
then pass screenshot coords directly without converting at every call site:

```js
// e.g. viewport 1728 vs screenshot 1456 -> 1.1868
const scale = window.innerWidth / SCREENSHOT_WIDTH;
```

Also disable any CSS transition on the cursor element itself — same reason as
above: the transition lags, and the ring separates from the pointer mid-glide.

---

## Tips

- **sips vs ffmpeg** (macOS): `sips` is the quick single-image probe — read
  dimensions (`sips -g pixelWidth -g pixelHeight -g format file.png`) or convert
  one file (`sips -s format png in.gif --out out.png`, grabs one frame). Use
  `ffmpeg` for anything multi-frame (extraction, tiling, conversion).
- **Faithful "before/after" work**: if you're driving a UI that *mutates* a live
  system and must leave it untouched, snapshot the exact state first and verify it
  after — e.g. grab the app's own API token by monkeypatching `fetch` in
  `javascript_tool`, then read/verify via its REST API. Capture the truth, don't
  assume it.
- **Before/after pairs**: to show a bug and its fix, `git stash` the fix to record
  the broken behavior, then `stash pop` — with a dev server running, hot-reload
  swaps the code under the same flow, so both takes stay identical apart from the
  thing you're demonstrating.
- **Clean stills without annotations** (Route A): re-record and export with
  `showClickIndicators:false, showActionLabels:false` (and watermark/progress off),
  then rip frames the same way.

## Concurrency (the old "one shared browser" fear is mostly legacy)

Work is scoped to a **tab group** (`tabs_context_mcp`), and multiple browsers can
be targeted (`list_connected_browsers` / `select_browser`), so parallel sessions
can each drive their own group/browser without the blanket "never run browser
tools in parallel" rule that used to apply. The one real residual caveat: the
`computer` tool's mouse/keyboard actions can contend on **foreground focus**, so
avoid heavy *simultaneous* `computer`-driving of the **same** browser.

## See Also

- **claude-in-chrome** skill — connecting to and driving the browser (navigation,
  clicking, reading the page). This skill picks up where that leaves off: getting
  the visuals onto disk.
- **upload-image-to-github** skill — if the captured images need to render in a
  GitHub PR/issue on a private repo.
