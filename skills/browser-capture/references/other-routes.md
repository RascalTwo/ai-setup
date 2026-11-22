# Other capture routes: spawned browser, and click-annotated GIFs

`SKILL.md` covers the default: `browse` screenshots and `browse recording` in the user's own Chrome. Read this when that cannot do the job.

## Contents
- Spawned browser: `record-flow.js` and `agent-browser record`
- Multi-page apps (the sharp edge)
- Getting into an authenticated app
- Click-annotated how-to GIF: ui-narration + `browse recording`
- Slideshow GIF: claude-in-chrome `gif_creator`

---

## Spawned browser: `record-flow.js` and `agent-browser record`

A browser the script launches itself. It has no session, never touches the user's Chrome or screen, and is deterministic, so it fits CI, background work, a page that needs no login, and scripted choreography you want byte-for-byte repeatable.

`scripts/record-flow.js` records **headless** Chrome at real frame rates via puppeteer's `page.screencast()`:

```bash
node scripts/record-flow.js --url http://localhost:5173 --out ~/.agents/state/browser/<task>/out.webm --gif
node scripts/record-flow.js --url http://localhost:5173 --out ~/.agents/state/browser/<task>/out.webm \
  --flow ./my-flow.js --fps 30 --viewport 1280x800 --mp4
```

Options: `--fps` (30), `--viewport WxH` (1280x800), `--scale` (1; 2 = retina), `--flow`, `--gif`, `--mp4`, `--headful`, `--no-kit`, `--chrome <path>`. The kit it injects is the `ui-narration` skill (cursor, highlight box, click pulse); the script exits with the paths it tried if that skill is missing, unless you pass `--no-kit`.

A `--flow` module exports `async (page, wt, nav) => {}`:

```js
module.exports = async (page, wt, nav) => {
  await wt(async () => {                              // same-document steps
    const card = await window.__narrate.waitFor(() => document.querySelector('.card'));
    await window.__narrate.focusAndClick(card, card.querySelector('h2'));
    await window.__narrate.smoothScrollTo(1400, 1800);
  });
  await nav(async () => {                             // a step that LEAVES the document
    const link = await window.__narrate.waitFor(() => document.querySelector('a.next'));
    await window.__narrate.focusAndClick(link);
  });
};
```

The `agent-browser` alternative (headless Chrome for Testing, no script to write): `agent-browser --session <name> open <url>`, `agent-browser --session <name> record start <file.mp4> [--cursor]`, drive it, `record stop`, then `close`. It needs ffmpeg.

Either route yields video; `scripts/to-gif.sh` turns it into a GIF.

## Multi-page apps (the sharp edge)

A recorder that only works on an SPA is a toy. Three things break the moment a real hyperlink swaps the document; `record-flow.js` handles all of them, so keep them intact:

- **Inject the kit with `evaluateOnNewDocument`, not `evaluate`.** `evaluate` injects once into the current document; a navigation destroys that context and `window.__narrate` with it.
- **`evaluateOnNewDocument` runs at document-start, when `document.body` is null**, so the kit builds its overlay lazily. A top-level `document.body.append(...)` throws there and `window.__narrate` then never exists on any page.
- **A navigating click cannot be a normal awaited call**: the context is torn down mid-`evaluate` and puppeteer rejects with "Execution context was destroyed". That is the expected outcome of a successful click. `wt()` swallows it; `nav()` pairs it with `waitForNavigation`.

Verified against a real cross-origin hyperlink (`example.com` to `iana.org`): cursor and highlight survive the jump in one continuous recording.

The same applies to a browse recording: `window.__narrate` does not survive a navigation, so re-inject after each `page.goto` or link click.

## Getting into an authenticated app

The spawned browser's one real weakness, and the reason browse is the default.

- **Copying the user's Chrome cookies does not ride an Entra/Azure AD SSO session.** Tested: a profile copy carrying all 3750 cookies including 4 `ESTSAUTH*` still hit an interactive password prompt (`sso_reload=true`: Entra tried silent SSO and fell back). Enterprise sessions are device-bound.
- In order: use browse in the user's Chrome; avoid auth (local dev server, mocked build); log in programmatically only where no human secret is involved; or do a one-time headful login into a persistent `--user-data-dir` and reuse it headlessly afterwards.

---

## Click-annotated how-to GIF: ui-narration + `browse recording`

The annotations are ours: the **ui-narration** skill injects a synthetic cursor, a highlight box, a click pulse and burned-in captions (`__narrate.say("…")`, with a `.vtt` sidecar from `__narrate.vtt()`). They render in the page, so any recorder captures them. Verified 2026-11-13 on example.cypress.io/todo: cursor, pulse ring and caption all visible in the MP4 and the 124-frame GIF.

```bash
browse recording start ~/.agents/state/browser/<task>/flow.mp4 -s <name>    # output path is required
browse execute -s <name> --timeout-ms 60000 '
await page.evaluate(await files.read(files.path("ui-narration.js"), "utf8"));
return await page.evaluate(async () => { await __narrate.ready(); __narrate.say("Open settings"); await __narrate.focusAndClick(document.querySelector("#settings")); await __narrate.sleep(1200); });'
browse recording stop -s <name>
scripts/to-gif.sh ~/.agents/state/browser/<task>/flow.mp4 ~/.agents/state/browser/<task>/flow.gif
```

Install the overlay as the ui-narration skill says (copy `ui-narration.js` into `files.dir` once) and re-inject it after every navigation. Drive the steps through `__narrate.focusAndClick` (it clicks for you), so every click gets its pulse. A Playwright click made outside it is unannotated.

## Slideshow GIF: claude-in-chrome `gif_creator`

Only when one frame per action is the goal (a how-to where motion is noise). `gif_creator` draws its own click marker and action label on each frame. The `browser` skill names claude-in-chrome as its fallback; load its tools in one ToolSearch call first.

```
gif_creator  action=start_recording
# ...drive with computer + navigate; each click/navigation = one frame...
gif_creator  action=export  download:true  filename="myflow.gif"   # -> ~/Downloads
```

| Goal | options |
|---|---|
| How-to (show where to click) | `showClickIndicators:true, showActionLabels:true, showWatermark:false, showProgressBar:false` |
| Cleaner / smaller | add `quality:8` (lower = better quality, larger file) |

Export clears the recording, so record and export each phase separately. Then rip stills:

```bash
ffmpeg -loglevel error -i ~/Downloads/myflow.gif frames/f-%02d.png
ffmpeg -loglevel error -framerate 1 -pattern_type glob -i "frames/*.png" \
  -vf "scale=360:-1,tile=5x6" -frames:v 1 contact.png   # contact sheet
```

`Read` the contact sheet, copy out the meaningful frames with descriptive names (`do-1-role-form.png`, not `f-08.png`) into `~/.agents/state/browser/<task>/`, then clean `~/Downloads`.
