# Other capture routes — spawned browser, and the GIF recorder

Read when Route 1 is impossible (no GUI, screen must not be touched, CI/background,
deterministic scripted choreography) or when a click-annotated how-to GIF is specifically
what is wanted. `SKILL.md` covers Route 1, which is the default.

---

# Route 2 — spawned browser (fallback)

`scripts/record-flow.js` records **headless** Chrome at real frame rates via puppeteer's
`page.screencast()`. No session, but it never touches the screen — right for CI, background
work, or when the user must not be interrupted at all.

```bash
node scripts/record-flow.js --url http://localhost:5173 --out /tmp/out.webm --gif
node scripts/record-flow.js --url http://localhost:5173 --out /tmp/out.webm \
  --flow ./my-flow.js --fps 30 --viewport 1280x800 --mp4
```

Options: `--fps` (30), `--viewport WxH` (1280x800), `--scale` (1; 2 = retina), `--flow`,
`--gif`, `--mp4`, `--headful`, `--no-kit`, `--chrome <path>`.

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

### Multi-page apps (the sharp edge)

A recorder that only works on an SPA is a toy. Three things break the moment a real hyperlink
swaps the document — all handled, but don't undo them:

- **Inject the kit with `evaluateOnNewDocument`, not `evaluate`.** `evaluate` injects once
  into the *current* document; a navigation destroys that context and `window.__narrate` with it.
- **`evaluateOnNewDocument` runs at document-start, when `document.body` is null** — so the
  kit builds its overlay **lazily**. A top-level `document.body.append(...)` throws there and
  `window.__narrate` then never exists *on any page*.
- **A navigating click can't be a normal awaited call** — the context is torn down mid-
  `evaluate` and puppeteer rejects with *"Execution context was destroyed"*. That's the
  expected outcome of a successful click. `wt()` swallows it; **`nav()`** pairs it with
  `waitForNavigation`.

Verified against a real cross-origin hyperlink (`example.com` → `iana.org`): cursor and
highlight survive the jump and keep working, in one continuous recording.

### Getting into an authenticated app

Route 2's only real weakness — and the reason Route 1 is the default.

- **Copying the user's Chrome cookies does NOT ride an Entra/Azure AD SSO session.** Tested:
  a profile copy carrying all 3750 cookies incl. 4 `ESTSAUTH*` still hit an interactive
  password prompt (`sso_reload=true` — Entra tried silent SSO and fell back). Enterprise
  sessions are device-bound. Don't spend an hour rediscovering this.
- In order: **use Route 1**; avoid auth (local dev server / mocked build); log in
  programmatically only where no human secret is involved; or do a **one-time headful login
  into a persistent `--user-data-dir`** and reuse it headlessly afterwards.

---

# Route 3 — GIF recorder (click-annotated how-tos)

```
gif_creator  action=start_recording
# ...drive with computer + navigate; each click/navigation = one frame...
gif_creator  action=export  download:true  filename="myflow.gif"   # -> ~/Downloads
```

| Goal | options |
|---|---|
| How-to (show where to click) | `showClickIndicators:true, showActionLabels:true, showWatermark:false, showProgressBar:false` |
| Cleaner / smaller | add `quality:8` (lower = better quality, larger file) |

Export **clears the recording** — record and export each phase separately. Then rip stills:

```bash
ffmpeg -loglevel error -i ~/Downloads/myflow.gif frames/f-%02d.png
ffmpeg -loglevel error -framerate 1 -pattern_type glob -i "frames/*.png" \
  -vf "scale=360:-1,tile=5x6" -frames:v 1 contact.png   # contact sheet
```

`Read` the contact sheet, copy out the meaningful frames with **descriptive names**
(`do-1-role-form.png`, not `f-08.png`), then clean `~/Downloads`.

