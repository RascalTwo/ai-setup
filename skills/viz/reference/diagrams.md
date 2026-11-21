# Drawing SVG diagrams without the usual rework

Read this before writing a boxes-and-arrows diagram — architecture, topology,
flowchart, state machine, swimlane, sequence. Not needed for charts (see the
`dataviz` skill) or for 3D.

Diagrams are where past vizzes bled the most iteration: labels overflowing their
boxes, arrows pointing at empty space or at the wrong box, whole diagrams
re-laid-out late. The root cause was always the same — **coordinates typed as
independent literals, then guessed wrong.** Everything below avoids that
structurally rather than fixing it after the fact.

## Derive geometry, never retype it

**Define each node once** as `{x, y, w, h}`, then compute every arrow endpoint and
label position *from* that geometry with `connect(a, b)` and `side(node, "right")` —
never as a separate literal. Now moving or resizing a box cannot strand its arrows.

**Budget the layout up front.** Decide the container width and the column positions
before placing anything, so the Nth element doesn't blow past the edge and force a
redo of the whole row.

## Labels: `labelBox()`, not raw `<text>`

Use `labelBox(node, html)` — a `<foreignObject>` — for anything multi-word. The
browser wraps and ellipsizes, so text **cannot** spill. Raw `<text>` has no overflow
protection; you'd be back to measuring widths by hand, which is exactly what kept
going wrong.

If you do hand-roll `<text>`, call `vizAudit()` after render: it red-outlines any
label that spills its box and shows a banner, so an overflow is visible in the open
browser (and in any screenshot) instead of discovered three commits later.

## Arrowheads: `arrowMarkers()`

Emits stable-id markers once; reference them with `marker-end="url(#ah-accent)"`.
SVG markers can't inherit a line's color, so you need one per color — the helper
handles that instead of you copy-pasting a `<marker>` block per hue.

## Past ~5 nodes with crossing edges, stop hand-placing

Reach for **[elkjs](https://github.com/kieler/elkjs)** (`https://esm.sh/elkjs`): you
hand it nodes + edges, it hands back coordinates, and **you still draw the SVG
yourself** in your own styling — it replaces the coordinate math, not the craft.
Manual placement past ~5 nodes is where the rework lives.

Avoid `dagre` — unmaintained, last release 2019. Mermaid is fine for a throwaway
diagram, but its default look is generic; don't reach for it when the diagram *is*
the deliverable.

## The silent one: `w`/`h` are not SVG attributes

`{x, y, w, h}` is the node shape, not the SVG attribute set. `<rect w= h=>` isn't an
error — SVG ignores unknown attributes, so the box renders at zero size: invisible,
clean console, nothing to debug. It's `width`/`height`; only `x`/`y` carry over.

The tell is verify's census saying `rendered: 0 rect` when you drew twelve.
