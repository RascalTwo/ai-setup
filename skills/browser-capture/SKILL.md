---
name: browser-capture
description: >-
  Save screenshots, animated GIFs, or smooth VIDEO of a browser page to disk, so they can be
  embedded in a doc, guide, PR, report, or artifact. Use for "add screenshots of the steps",
  "show how to do X in the UI", "record a walkthrough", or "make a video of this" — and
  especially when the app needs the user's real LOGIN/SSO session, or a GIF came out choppy,
  jumpy or slideshow-like and someone wants real smooth video.
---

# browser-capture

Turn a browser flow into image or video files you can embed. Three routes, in strict order
of preference. Each obvious shortcut here fails *silently*, which is how this costs hours
instead of minutes — so pick the route first.

Dependencies: **ffmpeg** on PATH. Route 2 also needs **puppeteer-core** (the viz skill ships
one at `~/.claude/skills/viz/node_modules/puppeteer-core`; `record-flow.js` finds it).

## Pick the route

| | Route | Real login/SSO? | Human? | Use when |
|---|---|---|---|---|
| **1** | **MCP capture — the user's own Chrome** | ✅ **yes** | ~1s, no clicks | **Default. Prefer always.** |
| **2** | Spawned browser (`record-flow.js`) | ❌ no session | none | Route 1 impossible: no GUI, screen must not be touched, CI/background, or deterministic scripted choreography |
| **3** | GIF recorder (`gif_creator`) | ✅ yes | none | You specifically want a click-annotated how-to GIF and don't need smooth motion |

**Prefer Route 1 by default.** It records the user's *actual* browser — their real session,
their SSO, their data, at their real device pixel ratio (Retina). Nothing else can do that.
Route 2 is a capable fallback that never touches the screen. Route 3 is only for annotated
click-by-click GIFs — and note you can always convert a Route 1/2 video to GIF with ffmpeg,
which usually looks better than the GIF recorder anyway.

**The GIF trap:** `gif_creator` yields a **slideshow**, always — one frame per *action*, and
extra `screenshot` calls add **zero** frames. If a GIF looks "janky" or "choppy", that isn't
a quality bug to iterate on; it's Route 3 working as designed. Switch routes, don't try harder.

**Sizing a GIF for where it lands.** Converting a video to GIF is unbounded by default,
and the destination is what actually constrains it. Budgets worth hitting:

| Destination | Size | Frame rate | Colors | Length |
|---|---|---|---|---|
| Slack custom emoji | 128×128 | 10–20 fps | 48 | under 3s, must loop |
| Slack message / PR / Confluence | up to 480×480 | 15–30 fps | 64–128 | under 10s |

Colors are the cheapest lever — an `ffmpeg` palettegen pass at 64 colors is usually
indistinguishable and a fraction of the size. Dropping frames beats dropping dimensions
for a UI recording, because unreadable text is worse than slightly choppy motion.

**Routes 2 and 3 are written up in [`references/other-routes.md`](references/other-routes.md).**
Everything below is Route 1.

---

# Route 1 — record the user's real Chrome (default)

Records the tab the MCP is already driving, via `getDisplayMedia({preferCurrentTab})` +
`MediaRecorder`, downloading through a real `<a download>` click. Full frame rate, real
device pixel ratio, real session. **No picker appears and the user clicks nothing.**

### The one constraint

All three must hold **at the instant capture starts** — and only then:

1. the target tab is the **selected** tab in its window
2. its window is **frontmost / not occluded by another app**
3. a **trusted click** lands within ~5s (the MCP `computer` tool's clicks *are* trusted)

Miss any one → `InvalidStateError: Invalid state`. That error means **"tab not visible"** —
it does *not* mean capture is impossible. macOS marks a Chrome page `hidden` when its window
is **occluded by another app**, so an editor sitting on top is enough to break it.

**Once capture is live, Chrome pins the tab visible and none of it matters any more.**
Verified: with a recording running, burying Chrome behind another app kept
`visibilityState: "visible"` with `hasFocus: false` and the counter advancing exactly in real
time (50 ticks / 5.0s). The user can switch apps, cover the window and keep working.

> **Unverified:** switching to a *different Chrome tab* mid-capture. Occlusion is proven safe;
> tab-switching is probably fine (it's how Meet tab-sharing behaves) but has not been tested.
> Until it is, tell the user to avoid switching tabs while recording.

### The procedure

```
0. TELL THE USER what they are about to see (one line in chat, before step 2)
1. javascript_tool : inject assets/mcp-recorder.js         -> window.__cap
   (optional)      : inject the `ui-narration` skill       -> window.__narrate (cursor/highlight)
2. javascript_tool : window.__cap.armButton()              -> full-viewport click target
3. bash            : scripts/raise-chrome.sh <url-substring>
4. computer        : SCREENSHOT, then click the target's centre in THAT screenshot's coords
5. javascript_tool : window.__cap.state === 'RECORDING'    (else window.__cap.diagnose())
6. javascript_tool : window.__cap.park() -> coords; computer: click them (parks the real
                     OS pointer out of frame — getDisplayMedia captures the system cursor)
7. drive the flow  : javascript_tool / computer
8. javascript_tool : await window.__cap.stop()             -> ~/Downloads/<filename>
9. bash            : verify + convert (below)
```

**Anything longer than a few seconds: read
[`references/long-takes.md`](references/long-takes.md) first.** Steps 5–7 collapse into one
gated loop there, because checking `state` and then driving in separate calls loses every beat
that runs before the user has approved capture.

### Step 0 — say something first (do not skip)

`armButton()` throws a **red overlay across the user's entire screen**, and raise-chrome.sh
then yanks Chrome in front of whatever they were doing. **You** click the overlay — the MCP
`computer` tool's clicks are trusted, so the user never has to touch it. But they don't know
that, and from their side a giant red panel just ate their screen. Reported verbatim by a
user: *"I had no idea I, as a human, was supposed to click that."*

One line in chat before you arm it is enough:

> Recording the browser now — you'll see a red overlay flash across Chrome for a second.
> Ignore it, I click it myself; nothing is needed from you.

Same reason the default label is worded at the human ("Claude is starting a screen
recording / No action needed") rather than as the imperative "CLICK TO START RECORDING".
If you override `label`, keep that property.

**Step 4 is where this actually goes wrong.** Screenshot dimensions change between calls
(observed 1456×840 then 1502×818 for the same 1728px viewport), so a scale factor computed
earlier silently misses. **Always screenshot immediately before clicking and use that image's
coordinates.** `armButton()` covers the whole viewport for exactly this reason. If a click
seems to do nothing, verify events are landing at all:

```js
window.__clicks = [];
document.addEventListener('click', e => window.__clicks.push([e.clientX, e.clientY, e.isTrusted]), true);
```

If `__cap.state` stays `idle` with `__clicks` empty, the click isn't reaching the page —
re-screenshot and re-click; don't keep changing the JS.

**`idle` but `__clicks` shows a trusted click on some *other* element → top-layer.** An open
`<dialog>` (or anything via `showModal()`/popover) paints above **every** z-index, so a
target appended to `<body>` sits underneath it and your click hits the dialog instead.
`armButton()` now hosts inside `dialog[open]` / `[role="dialog"]` when one is present and
returns `host` so you can confirm. Seen on Phoenix's session-detail modal: the click logged
as `[864, 471, true, "SPAN"]` while `state` never left `idle`.

### Verify + convert

```bash
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames,width,height -of default=nw=1 ~/Downloads/capture.webm
ffmpeg -y -loglevel error -i ~/Downloads/capture.webm -movflags faststart -pix_fmt yuv420p \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ~/Downloads/capture.mp4
```

Hundreds of frames = real video. `yuv420p` + even dimensions are required for QuickTime/Slack
to play it at all. **MediaRecorder webm is variable-frame-rate**, so `-vf select='eq(n,N)'`
frame-index extraction is unreliable — **seek by time** (`-ss 7` / `-sseof -2.5`) instead.

### Authentication — the whole reason this route wins

The MCP is the user's real browser, so their sessions are already there. A protected app
typically shows an account picker listing accounts already marked **"Signed in"** — one
click and you're in, **no password**.

**Never type the user's credentials.** If a real password field appears, stop and hand back
to the human. That's a hard line, not a difficulty.

---

## The visual layer — the `ui-narration` skill

**A hard dependency.** `record-flow.js` injects it unless you pass `--no-kit`, and exits with
the paths it tried if the skill is not installed. It exposes `window.__narrate`.

**Read [`ui-narration`](../ui-narration/SKILL.md) for the API** — the cursor, highlight box,
click pulse, `typeInto`/`drag`/`smoothScrollTo`, and the caption primitives. It is not repeated
here; one home per fact.

What belongs *here* is what it means for a **recording** specifically:

- **`waitFor` everything.** An early click is the most common way a take breaks.
- **Frame one element, click another** when a card's centre sits over some other control —
  that is what the two arguments to `focusAndClick` are for.
- **Assert on geometry, never on "the call returned".** A drag or resize that does *nothing*
  is indistinguishable from one that works: the handle is there, `waitFor` resolves, nothing
  throws, and the element's rect comes back byte-identical. Measure before and after.
- **`clap()` is the one recorder-aware call** — two white sync frames to align against this
  script's own clock. Meaningless outside a recording.
- **Captions ride along.** If the flow calls `__narrate.say()`, this script writes
  `<name>.vtt` beside the video, so one take ships burned-in *or* clean plus a sidecar.

Internals of the overlay itself live in
[`ui-narration`](../ui-narration/SKILL.md); recording-side gotchas are in
[`references/gotchas.md`](references/gotchas.md).

---

## Read next

`SKILL.md` covers Route 1 end to end, which is the default and the common case. Everything
situational lives beside it:

| Read | When |
|---|---|
| [`references/long-takes.md`](references/long-takes.md) | **Anything longer than a few seconds.** Gating the choreography, parking the OS pointer, clapping and trimming both ends, keeping the rig in a file, polling under CDP's 45s limit, verifying a re-record structurally. |
| [`references/other-routes.md`](references/other-routes.md) | Route 1 is impossible (no GUI, CI/background, screen must not be touched), or a click-annotated how-to GIF is what's wanted. Includes the multi-page-app sharp edges and why copying cookies won't ride an SSO session. |
| [`references/sanitized-screenshots.md`](references/sanitized-screenshots.md) | **Stills destined for a document** (runbook, wiki page, onboarding guide) where the page shows real account IDs, names or emails. Sanitizing the DOM before capture, boxing the control, anchored cropping — and why stills don't need the Route 1 rig at all. |
| [`references/gotchas.md`](references/gotchas.md) | Something behaves strangely, or you're about to modify the kit. Verified dead ends — don't re-derive them. |

## See Also

- **claude-in-chrome** skill — connecting to and driving the browser. This skill picks up
  where that leaves off: getting the visuals onto disk.
- **confluence-editor** skill — if the captured images go into a Confluence page.
- **upload-image-to-github** skill — if the captured images need to render in a GitHub
  PR/issue on a private repo.
