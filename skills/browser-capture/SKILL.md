---
name: browser-capture
description: "Saves screenshots, GIFs, or smooth video of a browser page to disk for docs, PRs, or reports. Use for \"add screenshots of the steps\", \"record a walkthrough\", \"make a video of this\", apps needing the user's real SSO login, or choppy GIFs."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    chrome: OpenCode Browse recording and screenshots in the user's own Chrome (default); spawned headless Chrome for scripted takes
  requires:
    skills: [browser, ui-narration]
    commands: [ffmpeg, node]
    manual: [Chrome]
---

# browser-capture

Turn a browser flow into image or video files you can embed. The `browser` skill picks the tool and owns the session recipe; this skill is what to run once the question is "get it onto disk", and what makes the file good. Everything below uses **browse** (the `browser` skill's default), which drives the user's own Chrome, so a signed-in or SSO app captures with no login step. Save outputs in `~/.agents/state/browser/<task>/`.

Dependencies: **ffmpeg** and **ffprobe** on PATH. Only `scripts/record-flow.js` needs **puppeteer-core** (the viz skill ships one at `~/.claude/skills/viz/node_modules/puppeteer-core`).

## Pick the capture

| You want | Do | Real login/SSO |
|---|---|---|
| A still: viewport, full page or one element | `page.screenshot` / `locator.screenshot` ([Stills](#stills)) | yes |
| Smooth video of a flow | `browse recording` ([Video](#video)) | yes |
| A GIF | record video, then `scripts/to-gif.sh` ([GIF](#gif)) | yes |
| Stills for a runbook or wiki that show account IDs or emails | [`references/sanitized-screenshots.md`](references/sanitized-screenshots.md) | yes |
| A take longer than ~10 s, or a page you own that can seek | [`references/long-takes.md`](references/long-takes.md) | yes |
| A scripted take that must not touch Chrome at all, CI, or a page needing no login | `scripts/record-flow.js` or `agent-browser record` ([`references/other-routes.md`](references/other-routes.md)) | no |
| A click-annotated how-to GIF (cursor, highlight, click pulse, captions) | `browse recording` with the **ui-narration** overlay, then `scripts/to-gif.sh` ([`references/other-routes.md`](references/other-routes.md)) | yes |
| A slideshow GIF, one frame per action | claude-in-chrome `gif_creator` ([`references/other-routes.md`](references/other-routes.md)) | yes |

**The GIF trap.** `gif_creator` yields a slideshow: one frame per action. A GIF made from a `browse recording` video has the video's motion, so a "choppy GIF" is fixed by switching capture path, not by tuning. Click annotations come from our ui-narration overlay, not the recorder, so they work on the video path too; use `gif_creator` only when a slideshow is the goal.

## Stills

Set up once per take: `browse session new <name>`, then one `browse execute -s <name> --timeout-ms 60000` script that navigates, waits for the page to settle, captures and returns the temp path. Give every action its own `{ timeout: 5000 }`. Delete the session when done.

```js
await page.goto(url, { timeout: 30000, waitUntil: "load" });
await page.setViewportSize({ width: 1280, height: 800 });      // optional: a predictable frame
const vp   = files.path("viewport.png"); await page.screenshot({ path: vp });
const full = files.path("full.png");     await page.screenshot({ path: full, fullPage: true });
const el   = files.path("list.png");     await page.locator(".todo-list").screenshot({ path: el, timeout: 5000 });
return { vp, full, el };
```

`cp` each returned path into `~/.agents/state/browser/<task>/` right away: `files.path` is a temp folder and other output paths are refused. Give files descriptive, ordered names (`03-role-form.png`, not `shot.png`).

Quality bars, each measured on the user's Chrome:

- **Pixels are CSS pixels times the device pixel ratio.** A 1672×947 viewport at ratio 2 saved as 3344×1894. Check with `sips -g pixelWidth -g pixelHeight <file>` and downscale for the destination rather than shooting small.
- **`fullPage: true` on a page that already fits the viewport equals the viewport shot.** On a 7607 px page it saved 15214 px tall (3320 wide: scrollbar excluded).
- **`page.screenshot` renders the page, not the OS pointer**, so there is nothing to park.
- **`setViewportSize` takes effect in the user's tab** (it read back 1280×800). It resets when the session is deleted.
- **Crop anchored to the top-left**: `ffmpeg -y -i in.png -vf "crop=W:H:0:0" out.png`. `sips -c H W` crops from the centre and eats the header.

## Video

`browse recording` records the session's tab as H.264 MP4 (or WebM) straight to the path you give. It records over CDP, so the tab stays in the background: the user keeps working and nothing flashes on their screen.

```bash
browse session new <name>
browse execute -s <name> --timeout-ms 30000 'await page.goto(URL, { timeout: 20000 }); return 1'   # get to the start state first
browse recording start -s <name> --cursor --json ~/.agents/state/browser/<task>/flow.mp4
browse execute -s <name> --timeout-ms 60000 --file flow.js     # the whole choreography, one script
browse recording stop -s <name> --json                         # writes the file plus flow.mp4.json
browse session delete <name>
```

1. **Get to the start state before recording**, so the first frame is the page you want, not a load spinner or last run's data.
2. **Choreograph in one script.** Pace it for a viewer: `pressSequentially(text, { delay: 40 })` rather than `fill`, `waitForTimeout(500)` between beats, a 1 to 2 s hold on the final state. `--cursor` draws browse's ghost cursor so a viewer sees what was clicked; for a highlight box, click pulse and eased scroll instead, inject the `ui-narration` skill (it documents the browse install). Pick one cursor, not both.
3. **The default is `--mode auto`**: CDP for browse sessions, 60 fps target, MP4 or WebM. `--mode tab-capture` is WebM only and needs the user to click the browse toolbar icon on that tab first, so use it only for a tab a human already owns. `--max-duration-ms` auto-stops a forgotten recording (default 15 minutes).
4. **Frames follow repaints.** `browse recording status -s <name> --json` shows `achievedSourceFrameRate`. A CSS animation recorded at about 60 source frames per second; typing through browse recorded about 10 distinct frames per second, with the rest held, so keystroke-heavy takes look stepped. Slow the choreography or lead with motion (smooth scroll, transitions) when smoothness is the point.
5. **Verify the file** before reporting it:

```bash
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=codec_name,pix_fmt,width,height,nb_read_frames:format=duration -of default=nw=1 flow.mp4
```

Hundreds of frames for a few seconds is a real video. The file comes out `yuvj420p` (full range), which some players mishandle. For QuickTime, Slack or Confluence re-encode:

```bash
ffmpeg -y -loglevel error -i flow.mp4 -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2:out_range=tv,format=yuv420p" \
  -color_range tv -movflags +faststart flow-share.mp4
```

**Capture something you did not plan to record.** `browse flight-recorder start -s <name>` keeps a rolling in-memory buffer (60 s by default, up to 120 s). Do the flow, then `browse flight-recorder save-last -s <name> --duration-ms 30000 <path>.mp4`, then `browse flight-recorder cancel -s <name>`. Only repaints are buffered, so idle stretches vanish and the clip can be shorter than `--duration-ms`.

## GIF

```bash
scripts/to-gif.sh <in.mp4> <out.gif> [width=800] [fps=15] [colors=128]    # prints frames, size, bytes
```

It runs ffmpeg's palettegen and paletteuse in one call (one palette per clip: crisp UI text at a fraction of the size). A 4.7 s recording became 71 frames at 800×453, 54 KB. Check `frames > 1` in its output.

Size the GIF for where it lands; colors are the cheapest lever, and dropping frames beats dropping dimensions because unreadable text is worse than slightly choppy motion:

| Destination | Size | Frame rate | Colors | Length |
|---|---|---|---|---|
| Slack custom emoji | 128×128 | 10–20 fps | 48 | under 3s, must loop |
| Slack message / PR / Confluence | up to 480×480 | 15–30 fps | 64–128 | under 10s |

## The user's real login

The session's tab is the user's own Chrome, so their SSO is already there, typically an account picker showing accounts marked "Signed in", one click and you are in. Type no credentials: for a password, 2FA or payment, call `handoff()` in the script, let the user finish in the tab, and carry on after Continue. A brand-new tab has no `sessionStorage`, so an OIDC app can land on its login page; a reload of an existing tab keeps the session. Tell the user the capture contains their real data, and where the file landed.

## Read next

| Read | When |
|---|---|
| [`references/sanitized-screenshots.md`](references/sanitized-screenshots.md) | Stills destined for a document where the page shows real account IDs, names or emails: sanitize the DOM before capture, box the control, crop anchored. |
| [`references/long-takes.md`](references/long-takes.md) | Anything longer than ~10 s: timeouts, trimming head and tail from the recording's own clock, seekable pages (frame-exact, no real-time recording), re-recording. |
| [`references/other-routes.md`](references/other-routes.md) | `record-flow.js` and `agent-browser record` (spawned browser, no login), multi-page-app sharp edges, and the claude-in-chrome `gif_creator` fallback. |
| [`references/gotchas.md`](references/gotchas.md) | Something behaves strangely: verified dead ends and tips. |

## See Also

- **browser** skill: tool choice, the browse session recipe, handoff.
- **ui-narration** skill: highlight box, click pulse and eased scroll for recordings.
- **confluence-editor** skill: if the captured images go into a Confluence page.
- **github-attach-media** skill: if the captured media must render in a GitHub PR or issue on a private repo.
