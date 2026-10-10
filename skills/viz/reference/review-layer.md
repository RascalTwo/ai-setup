# Reviewing a viz — the feedback widget

Every viz carries a **feedback widget**: a pill in the bottom-right corner with two buttons, 🎙 (the mic) and 💬 (the panel: everything said, picked and pointed at, with Copy, Text only and Send at its foot). The user gives feedback two ways:

- **Talk while pointing.** 🎙 starts the mic. Each stretch of speech, split at a pause, is transcribed **on this device** and anchored to what the mouse is over **when the stretch ends**, so the user talks, then aims. The widget also records what the mouse was over **when the stretch began** (`from`), so a line can say "started on the legend, ended on the 2019 bar". A dot follows the cursor while it hears them; a "…" caption lands on the element, then the text.
- **Alt/Option-click** anything → "Provide feedback here" → a typed line anchored to exactly what was clicked.

The engine is the first that works (ADR 0025): Parakeet if this browser already downloaded it (WebGPU, ~2.4 GB, cached); else the browser's own on-device recognizer, with ⬆ Parakeet in the panel's header offering the download; else that offer in place of the mic; else typing only, which always works. Lines anchored to the same element share one pin (a stack, "×3"); a pin whose element has gone parks greyed out top-right rather than vanishing. The panel folds lines by what they're about (once there are more than eight), shows each line's crops (click one to see it full size; ← → steps between a line's crops) and the page's picks, and is the only place page-level lines show. The user can click a line's text to edit it, or 🗑 it. Audio never leaves the tab and is never saved.

**Crops.** Each spoken line keeps two pictures, as it began and as it ended, drawn **from the page itself** (`kit/screenshot.js`, loaded on first use): no screen-share prompt, sharp at any zoom, with a red dot where the pointer was. WebGL keeps its last frame for this (a one-line script first in `<head>`), videos are drawn frame by frame, and webfonts are embedded. **Known limit:** a page can't read another site's embedded frame, or a video from a site that doesn't allow it, so those show in a crop as a labelled grey box ("embedded example.com: can't be drawn"). Everything else on the page is drawn.

**Where it saves (ADR 0026).** On a live page, through the server's page data route (below). With no server (an exported or published single file, a frozen run), in **this browser** (IndexedDB), kept per **page stamp**, a hash of the page's source: answers survive closing the tab, and a newer version of the page starts clean. The panel's **Copy** is then how answers leave: one click puts the full text (the `--detail` view, with crops named "crop 3"), the same text with the crops inline as HTML, and one numbered contact sheet of every crop on the clipboard, and each app keeps what it understands (Slack keeps the picture; a notes app or email keeps text and every crop; a prompt keeps the text). **Text only** copies just the words. Copy works on live pages too. Every self-contained build carries the widget (about 160 KB, 60 KB gzipped); a page keeps it out with `<meta name="viz:feedback" content="off">`. Share cards and film renders never show it. A page can also host it itself: set `window.vizFeedbackHost = { root, log, shoot? }` and load `/_kit/feedback.js`, and it runs scoped to `root`, handing every line to `log` and every crop to `shoot` (the grill-me-viz poster's demo does this; see the type in `kit/src/feedback.ts`).

**Anchor:** the nearest `[data-viz-id]` above the pointer, else the nearest `<section>`, else the page. So **stamp `data-viz-id` (and a human `data-label`) on every meaningful mark** — a bar, a packet, a graph node. Without one, a line lands on the section, and an Alt-click falls back to a brittle `:nth-of-type` path. With one, the anchor survives reorders and reads as a named thing.

## Reading and resolving

Everything is one append-only log, `<viz>/.viz-data/feedback.jsonl` (the page data route, ADR 0019; git-ignored, never published). Read it with `viz feedback`, which folds it into what's on the page:

```bash
viz feedback <viz-dir>            # level 1: each line's id and text, grouped by what it's anchored to ("← from X" when speech began elsewhere)
viz feedback <viz-dir> --detail   # level 2: + pointer x,y (start and end), window size, scroll, #hash, the exact element, crop paths
```

Start at level 1; the anchor usually says enough. Reach for `--detail` when it doesn't (a line anchored to a whole section, or to the page). Then edit the viz, and mark each line done with a one-line note on **what you changed**, shown under the line so the user knows what to check:

```bash
viz feedback <viz-dir> --resolve <id>,<id> --note "2019 bar is red now"
```

**The lifecycle — each actor owns one transition.** The user creates and deletes; you resolve. A resolved line turns its pin green, meaning "Claude thinks this is done — go check." The user looks at the changed viz and clears it (✓) or says more. You never delete a user's line. (`--clear` drops every line from the page at once; it exists for grill-me-viz, which consumes a round's lines after reading them.)

**Send.** The panel's Send (a dot on 💬 means something new hasn't been sent) writes `{"type":"send"}` after every line still being transcribed has landed, so nothing said mid-click is lost. Send also pauses the mic — no listening while Claude works; the user resumes it by hand. If you're waiting on the user, wait on that line in the background:

```bash
until grep -q '"type":"send"' <viz-dir>/.viz-data/feedback.jsonl; do sleep 1; done
```

If you aren't waiting, the user tells the terminal instead; read everything up to the last send. Feedback from someone else's copy arrives as pasted text and a picture: the text has the same shape `viz feedback --detail` prints.

**Optional pause hook.** If a viz exposes `window.__vizPause()` / `window.__vizResume()`, the widget calls them while the Alt-click composer is open, so an animated target holds still while the user types. A no-op if absent.
