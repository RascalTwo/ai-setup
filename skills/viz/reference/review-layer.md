# Reviewing a viz — the anchored comment layer

Every live viz carries a **review layer**: the user **Alt/Option-clicks any element** (a bar, a node, even a moving packet) and a bubble opens to leave a comment — typed, or dictated on-device. The comment **anchors to that element** (a robust CSS selector + its text + its `data-*` attrs, captured at click time) and a **pin** renders that *follows the element even as the viz animates* (a `requestAnimationFrame` loop re-reads `getBoundingClientRect()` each frame). It's auto-injected on every viz with zero setup, exactly like the hot-reload script — and **dev-server-only by construction**: the overlay and its `_comments` route are absent from `--frozen` runs and published/static builds, so nothing leaks into shared artifacts.

This is how the user hands *you* visual, located feedback to act on. Comments persist as a **bare array** in `comments.json` **beside the viz's `index.html`** — greppable and hand-editable, but **never committed**: it's transient review scratch, so `comments.json` is git-ignored in every viz container (central and repo-local), and bootstrap maintains that ignore on every run. Don't `git add -f` it.

**The lifecycle — each actor owns exactly one transition:**

| Transition | Who | How |
|---|---|---|
| create → `status: "open"` | **user** | Alt-click + bubble submit |
| `open` → `resolved` | **you (the agent)** | after editing the viz to address it |
| delete | **user** | reviews the resolved pin, approves (✓ / 🗑) |

**You never delete; the user never resolves.** A `resolved` pin means "Claude thinks this is done — go verify." The user eyeballs the (now visibly changed) viz and either clears the pin or re-comments if the fix is wrong. Nothing vanishes under the user.

**Your read/resolve path** (the server scopes the route to the viz's own dir, so paths are relative to `http://127.0.0.1:5180/<viz-id>/`):

```bash
# 1. Read the open comments — straight off disk, or over the route.
cat "$VIZ/<slug>/comments.json"            # central; or <repo>/viz-pages/<slug>/comments.json
curl http://127.0.0.1:5180/<viz-id>/_comments

# 2. Edit the viz to address each one (each comment names its element via
#    anchor.selector / anchor.text / anchor.dataAttrs, and the beat via vizState —
#    NOT pixel coordinates).

# 3. Mark it resolved, with a one-line note on WHAT you changed (shown on the pin
#    so the user knows what to verify before approving):
curl -X PATCH http://127.0.0.1:5180/<viz-id>/_comments/<id> \
  -H 'content-type: application/json' \
  -d '{"status":"resolved","resolution":"set the 2019 bar fill to var(--danger)"}'
```

A comment's shape (the `resolution` field is yours to fill on resolve):

```jsonc
{
  "id": "c1f8k2", "text": "make this red", "status": "open",
  "vizState": "#act=3&beat=2",                       // location.hash at capture — the beat to reproduce
  "anchor": {
    "selector": "rect[data-viz-id='bar-2019']",      // robust CSS selector (HTML + SVG)
    "text": "2019: 4.2M",                             // element.textContent (omitted if empty)
    "dataAttrs": { "viz-id": "bar-2019", "label": "2019" }  // omitted if none
  },
  "resolution": "set fill to var(--danger)"           // added by the agent on PATCH (optional)
}
```

**Authoring convention — stamp `data-viz-id` (and `data-label`) on meaningful marks.** A bar, a packet, or a graph node has no text, so without a stamp its anchor falls back to a brittle structural `:nth-of-type` path. Giving the things a user will plausibly comment on a `data-viz-id="bar-2019"` (and a human-readable `data-label`) makes their anchors **stable and legible** — the selector survives reorders and the comment reads as a named thing, not coordinates. Do this when you build any chart/diagram/animation.

**Optional pause hook.** If a viz exposes `window.__vizPause()` / `window.__vizResume()`, the overlay calls them while a comment bubble is open, so an animated target holds still while the user composes. It's a no-op if absent — purely an authoring nicety for heavily-animated vizzes.
