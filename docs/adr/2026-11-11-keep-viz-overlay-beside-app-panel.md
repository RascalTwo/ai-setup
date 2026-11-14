# Keep viz-overlay as its own skill beside app-panel, for now

Status: Proposed, 2026-11-11

## Context and Problem Statement

`app-panel` and `viz-overlay` both put a web page in a native macOS panel driven by a Swift helper. They reuse the same tricks: herdr pane focus gating, and typing messages into the agent's pane. One host could serve both: app-panel's card would be viz-overlay with a "docked" placement beside the terminal. The question came up in grill-viz-overlay round 2 on 2026-11-11.

## Decision

Keep them as two skills for now. app-panel is an MCP server bound to MCP Apps, and it is deleted once Claude Code renders MCP Apps itself. viz-overlay is a CLI that a viz drives over any app. Merging now would tie a long-lived tool to a temporary one before either had real use.

We accept the duplicated Swift helper and focus-gating code until the revisit. viz-overlay's page contract must stay free of assumptions that would block a docked placement.

## Alternatives Considered

- Merge now, with app-panel as viz-overlay's docked placement: one host and no duplicated code, but app-panel's removal would then mean unpicking a shared tool, and neither had been used for real.
- Build app-panel on top of viz-overlay later, without merging the skills: keeps the split while sharing the helper, but it is the same coupling with less to show for it until viz-overlay has real use.

## More Information

- Revisit after viz-overlay has been used for real: run `steelman` on the merge then.
- Rewritten 2026-11-13 from ADR 0001; alternatives reconstructed from code and history where the original did not record them.
