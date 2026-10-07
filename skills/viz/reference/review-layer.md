# Reviewing a viz — the feedback widget

Every live viz carries a **feedback widget**: a pill in the bottom-right corner (🎙 mic · 📌 keep listening when the tab loses focus · 💬 count · Send). The user gives feedback two ways:

- **Talk while pointing.** 🎙 starts the mic. Each stretch of speech, split at a pause, is transcribed **in the browser** by Parakeet (WebGPU; a ~2.4 GB model downloaded once per browser, loaded on the first mic click) and anchored to what the mouse is over **when the stretch ends**, so the user talks, then aims. The widget also records what the mouse was over **when the stretch began** (`from`), so a line can say "started on the legend, ended on the 2019 bar". A dot follows the cursor while it hears them; a "…" caption lands on the element, then the text.
- **Alt/Option-click** anything → "Provide feedback here" → a typed line anchored to exactly what was clicked.

The mic needs Chrome with WebGPU and a network for that first download (a tab that can't run it shows why in the mic button's tooltip); the typed path always works. Lines anchored to the same element share one pin (a stack, "×3"); a pin whose element has gone parks greyed out top-right rather than vanishing. The 💬 count opens the full list, the only place page-level lines show. The user can click a line's text to edit it, or 🗑 it. Audio never leaves the tab and is never saved. The widget is auto-injected like the hot-reload script and **dev-server-only**: frozen-tape runs and published builds have neither the widget nor its route.

**Anchor:** the nearest `[data-viz-id]` above the pointer, else the nearest `<section>`, else the page. So **stamp `data-viz-id` (and a human `data-label`) on every meaningful mark** — a bar, a packet, a graph node. Without one, a line lands on the section, and an Alt-click falls back to a brittle `:nth-of-type` path. With one, the anchor survives reorders and reads as a named thing.

## Reading and resolving

Everything is one append-only log, `<viz>/.viz-data/feedback.jsonl` (the page data route, ADR 0019; git-ignored, never published). Read it with `viz feedback`, which folds it into what's on the page:

```bash
viz feedback <viz-dir>            # level 1: each line's id and text, grouped by what it's anchored to ("← from X" when speech began elsewhere)
viz feedback <viz-dir> --detail   # level 2: + pointer x,y (start and end), window size, scroll, #hash, the exact element
```

Start at level 1; the anchor usually says enough. Reach for `--detail` when it doesn't (a line anchored to a whole section, or to the page). Then edit the viz, and mark each line done with a one-line note on **what you changed**, shown under the line so the user knows what to check:

```bash
viz feedback <viz-dir> --resolve <id>,<id> --note "2019 bar is red now"
```

**The lifecycle — each actor owns one transition.** The user creates and deletes; you resolve. A resolved line turns its pin green, meaning "Claude thinks this is done — go check." The user looks at the changed viz and clears it (✓) or says more. You never delete a user's line. (`--clear` drops every line from the page at once; it exists for grill-me-viz, which consumes a round's lines after reading them.)

**Send.** The pill's Send (shown once there's something new) writes `{"type":"send"}` after every line still being transcribed has landed, so nothing said mid-click is lost. Send also pauses the mic — no listening while Claude works; the user resumes it by hand. If you're waiting on the user, wait on that line in the background:

```bash
until grep -q '"type":"send"' <viz-dir>/.viz-data/feedback.jsonl; do sleep 1; done
```

If you aren't waiting, the user tells the terminal instead; read everything up to the last send.

**Optional pause hook.** If a viz exposes `window.__vizPause()` / `window.__vizResume()`, the widget calls them while the Alt-click composer is open, so an animated target holds still while the user types. A no-op if absent.
