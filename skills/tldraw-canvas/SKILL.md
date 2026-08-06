---
name: tldraw-canvas
description: Read and edit a tldraw whiteboard — create shapes (boxes, sticky notes, arrows, frames, text), edit, rearrange, and clean up. Works over direct HTTP against a sync server with the agent API, or through Chrome MCP against any tldraw board including tldraw.com. Use WHENEVER the user wants to draw, diagram, sketch, or whiteboard on tldraw — draw X on tldraw, add a box labeled Y, tldraw this out. Also modify, re-color, re-label, or clean up shapes. Homophones teal draw, tealdraw, tl draw, td draw all mean tldraw.
---

# tldraw-canvas

Read and edit a tldraw board. There are two ways to reach one; pick the transport
first, then everything below applies either way.

## Pick a transport

**Prefer direct HTTP.** It's faster, works on boards nobody has open, and gives an
authoritative read to verify against. Fall back to the browser only when the board
can't be reached that way.

```
Does the board's sync server expose the agent API?
├─ yes, or TLDRAW_SYNC_URL is already set  →  references/transport-http.md
└─ no  (tldraw.com, or a deployment without those routes)
                                          →  references/transport-browser.md
```

Deciding, in order:

1. `TLDRAW_SYNC_URL` is set → HTTP. Sanity-check with the probe in that file.
2. User names a board on **tldraw.com** → browser. tldraw.com has no agent API;
   say so rather than guessing at endpoints.
3. User names a self-hosted board → ask whether its sync server has the agent
   API, or probe it. If not, browser.
4. Nothing known → **ask.** Don't guess a URL and don't reuse one from a previous
   session.

Read the transport file you picked before doing anything else — the two differ in
what you write and what you can do, not just in how you send it.

## What differs (so you know what you're choosing)

| | HTTP | Browser |
|---|---|---|
| Needs a tab open | no | yes |
| Records you write | complete | partials + helpers |
| Bindings | hand-written records | helper builds them |
| Text auto-sizing | no — explicit `w`/`h` | yes |
| Camera / `zoomToFit` | no | yes |
| Image export | no | yes |
| Who else is watching | `viewers` count | unavailable |
| Verification | authoritative read | screenshot |

## Everything below is transport-independent

### 1. Pick the board

- User gave a board URL or room id → use it.
- User said "a new board" → create one, and hand back the link when done.
- Otherwise → **ask.** Guessing means writing into someone's real work.

### 2. Read before you write

If the board holds shapes this skill didn't create (ids not starting with
`shape:ai-`), **say what's in it and confirm before adding.** Empty, or only
`shape:ai-` shapes → just proceed.

### 3. Plan the layout before placing a single shape

Required for anything over ~5 shapes. Write the plan out *in the response* first:

1. **Grid coordinates** for every shape (e.g. `p1Header: (0, 80) w=560 h=70`). List them.
2. **Arrow routes** as source/target pairs, one line each: "does this path cross
   any other shape's bounding box?" If yes, move a shape before building.
3. **Whitespace budget**: shapes don't touch; arrow lanes get at least one
   shape-width of clearance; **children stay inside their frame's bounds**.

Then actually run the check against your own numbers. It is easy to write this
section out and not apply it — that's the failure mode, not forgetting it exists.

Sizing heuristics: 2-line rectangle 260×110 · diamond with 2+ lines 320×200 · an
arrow carrying a 2-word label needs ≥300px of free path. On HTTP these are the
only sizing you get; in the browser, `autoSize` can do better.

### 4. Build

Construct records per **`references/records.md`** — the shape types, props, and the
arrow+binding pattern are identical on both transports. What differs is how much of
each record you write; the transport file says which.

Every id starts with `shape:ai-` / `binding:ai-` so cleanup targets only its own
work, never the user's.

When people are watching, splitting a build into a few logical batches makes it
animate in front of them instead of appearing all at once.

### 5. Verify

Confirm every shape you meant to create exists, every arrow has **two** bindings,
and no two bounding boxes overlap. That last one is arithmetic on the coordinates —
do it explicitly, because nothing else will catch it.

Prefer records over pixels wherever the transport offers them. On HTTP,
`GET /agent/room/:roomId` is the source of truth. **A browser tab is never the
oracle**: a hidden tab defers applying incoming sync messages, so it will report a
shape missing long after the write landed and every visible viewer already has it.

### 6. Report

Give the user the board link, what you made, and the shape count. Mention they can
say "clean up" to remove the `shape:ai-` shapes, or just hit undo.

## Safety

- **Never delete a shape whose id doesn't start with `shape:ai-`** without explicit
  confirmation. That's the user's work, and other people may be watching it live.
- **Check who's watching before a bulk edit** where the transport can tell you.
  Humans see every intermediate state.
- Deleting shapes *this session* created needs no confirmation — that's correcting
  your own output.
- Don't navigate away from a board with unsaved user intent (selected shapes,
  half-typed text) without asking.

## References

**Transports** — read the one you picked:
- **`references/transport-http.md`** — agent API: endpoints, full records, waking a
  cold server, `viewers`, and the server contract for implementing it elsewhere.
- **`references/transport-browser.md`** — Chrome MCP: tab targeting, bootstrap
  injection, `window.__td` helpers, screenshot verification.

**Shared:**
- **`references/records.md`** — record templates per shape type + the arrow/binding
  pattern.
- **`references/shape-schemas.md`** — every shape's props with valid enums.
- **`references/rich-text.md`** — the ProseMirror doc format for labels.
- **`references/td-api.md`** — full `window.__td` reference (browser transport only).
