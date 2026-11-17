# Developing /viz

For agents changing the skill itself. Using the skill is `SKILL.md`; decisions are `docs/adr/`.

## One feature, three surfaces

Every feature is one thing reached three ways: the **CLI** (`viz <verb>`), the **MCP**
(`viz_*` tools, generated from the same command tree), and the **UI** (the self-portrait,
which spawns the CLI). A new verb ships on all three in the same change.

Opting a verb out of a surface is allowed only where the surface genuinely cannot carry it —
declared in `meta()` (`lib/cli-meta.ts`) as `mcp: hidden` / `ui: cli-only` with a `why` that
names the obstacle. "Not built yet" is not a `why`. If the obstacle is a mechanism (a call
that outlives the MCP timeout, a result that needs a file handle), change the mechanism
first — e.g. start a job and return its id — before reaching for the opt-out.

`tests/ui-coverage.test.ts` holds the UI to these declarations; run `bun test` before you
call a surface done.

## Changing how a page renders

`bun maintainer/parity.ts shoot|compare` screenshots every state a reader can reach, before and
after, and pixel-diffs them — use it for any change that should leave a viz looking the same
(a language conversion, a kit refactor). Usage is in the file's header.

## Formatting

The skill's own TypeScript, CSS and HTML is formatted by the formatter it ships to vizzes (`lib/format/format.ts`, oxfmt defaults).
`bun run format` writes it; `tests/skill-format.test.ts` fails on any file left unformatted. Generated `.js` is rebuilt, never
formatted (`bun run sync:kit`). Formatting can move an `oxlint-disable` off the line it covers: run the skill lint test after.
