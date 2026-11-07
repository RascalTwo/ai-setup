# Scene kinds

Each renders identically in both modes: animated on the film, shown in its final state on the
review page. Pick the kind whose *form* carries the meaning; a scene of text in boxes is the
last resort.

| kind | shows | fields |
|---|---|---|
| `statement` | a title card or one claim | `big`, `sub`, `chips[]` |
| `flow` | something passes a step and loses (or keeps) parts of itself — the Why / What story scene | `from{label, text}` with `[[words\|detail]]` tokens, `via`, `to{label, mode: "drop"\|"keep", badge?, tone?}`, `ask{q?, a, badge?, tone?}`, `cards[]` |
| `compare` | before → after text, word-diffed: unchanged words muted, removed red, added green | `rows[{label?, before, after, note?, at?}]`, `beforeLabel`, `afterLabel` |
| `chat` | what a user asks, what they get | `messages[{who: "q"\|"a", text, badge?, tone?, at?}]` |
| `pipeline` | processing steps, before vs after — identical steps joined by a dashed line, new ones green, dropped ones red | `rows[{label, steps[], note?}]` (steps match by exact text) |
| `rules` | input → output per case, each with its test | `rows[{name, in, out, test?}]` — `**…**` in `out` marks what's new |
| `bars` | magnitudes; bar length = the number | `rows[{label, sub?, tag?, parts[{n, tone?, text?}]}]`, `legend[{tone, text}]`, `note`, `limit{n, label}` (a dashed threshold) |
| `cards` | a few findings, each with a verdict | `items[{title, body, badge?, tone?}]` |
| `steps` | a sequence — rollout, lifecycle | `nodes[{title, sub?, tone?}]`, `items[]` (cards below) |
| `look` | Where to look / Check these — `plan.lookHere`, one labelled row per line | `rows[]` — which lines, in order (`start`, `skip`, `unsure`, `feedback`; default all four) |
| `checklist` | a short list of checks | `items[]` |
| `trace` | every behavior × what proves it, coloured by status | from `behaviors` — no fields |
| `tour` | the diff, one step per beat | `entries[{hunk \| hunks[], say, text?, lines?}]` — `lines`: `[[from, to], …]` new-file line windows, to walk one long hunk (a whole new file) over several entries · `text`: the step written for reading, when `say` only works aloud ("dot py", "one forty-five"); the changes walkthrough uses it |
| `callgraph` | who reaches the new code: entry points → callers → it; green changed, amber unchanged-but-now-reaching (the blast radius) | `helpers[]` — function names from `callgraph.json` |
| `fixture` | the real test file's page, its real link rectangles (numbered) and URLs, malformed entries | `pages[{file, page?, at?}]` — from `fixtures.json` |
| `custom` | the one visual only this PR needs | `html`, `js?` |

`tone`: `good` · `warn` · `bad` · `info` · `teal` · `muted` (bars: hatched).

## Contents
- tour
- custom
- Pointers — point at what the narration is talking about
- flow
- Add-ons (addons/) — data the template can't get from a diff

## tour

Covers **every** production hunk — `build.ts` enforces it and lists hunk ids
(`path#n`, 1-based per file). An entry may take several hunks on one beat. Hunks carrying the
same code (80%+ of changed lines shared — a helper copied into three modules) draw once as
"same code in N files", and whatever a copy changes beyond it shows underneath as "only in
<file>", so nothing is hidden. Different hunks stack. Code is syntax-highlighted
(highlight.js, language from the file extension). On the film only changed lines ±1 of context show, with `⋯` for gaps; the review page
has the full diff with a "reviewed" box per file and each `say` above its hunk.

`"view": "3d"` (film only) stands the same panels in space instead of swapping them: x = module
(the path segment under `modules/`, `packages/`, …), z = tour order. An entry touching several
modules splits into a panel per module in its own lane, with each lane's pieces stacked in file order, so
put a file's import hunk in the same entry as the code using it and it becomes a pane above that code. Two panels get one wide shot of both, held.
Three or more hold on each panel for an equal share of the line, with a quick snap between, left to right
unless the entry's `"order"` (module names) matches the order the narration names them in. Same-code entries stand a copy in every
module that carries them. With two copies both are held in one shot; with three or more the camera
reads the middle one, with the others at the edges. Each
lane shows its own code path: a line down the lane from that module's panel to its next one,
numbered by step. Lines never cross lanes, because they follow the code, not the camera. Earlier
panels fade as the camera moves on. A route map in the heading band (a row per module, steps left
to right) lights the current stops and their modules. Highlighting and pointers are unchanged.
An entry with `"hunks": []` is an overview: its line plays while the camera pulls up to the
closest view that fits every panel, and the lane names fade in. Use it when the change spans
modules and *where* it lands is part of the story. For a one-module PR the flat tour reads
better. It replaces the flat tour, so don't also add a separate "where it changes" scene. A
short line (under ~3 s) gives the camera no time to settle on a multi-module entry, so give
those entries a full sentence.

## custom

`html` is a fragment file in the viz (e.g. `scenes/pdf.html`, its own `<style>` inline).
Inside it, `data-r="k"` appears on the scene's *k*-th line (0-based), `data-d` delays it,
`data-rx="k"` fades it out, `data-rfx="k"` starts its `--q` effect; `--p` / `--q` animate as in the kit's `film()`. Optional `js`
(`scenes/x.js`) default-exports `(el, scene, {mode})` and runs once the fragment is in the
page — before the film starts, so elements it creates with `data-b` animate too
(`scene.b0` is the scene's first beat). Measure with `getBoundingClientRect()` ÷
(`rect.width / el.offsetWidth`) to undo the stage's scale.

A 3D custom scene uses the kit's `stage3d.js` (viz `reference/timeline.md`), reached through
the third argument, since a blob-URL module can't import `/_kit/` itself:
`export default async (el, s, { mode, kit }) => { const { stage3d, plate } = await kit("stage3d.js"); await stage3d(el, { b0: s.b0, mode, stops, build, frame }); }`.
It handles film seeking, the final state for review and poster, and orbit plus per-stop replay
buttons in review. New `say` lines need `viz verify` before `viz render`, since verify is what
voices them. Only reach for 3D when depth means something in *this* PR. A scene that would look
the same in every PR (the branch stack, say) belongs on no PR.

## Pointers — point at what the narration is talking about

In any `say` line, `[words](target)` is spoken as just *words*, and the target lights up from
the moment those words are said until the next mark on the line (or the line's end). Timing
comes from Kokoro's word timestamps, compiled into the manifest by `viz verify`. The look is
`ui-narration`'s highlight box, so films point the same way browser recordings do.

Targets, comma-separated (any of them may take a leading `^` to point instead of highlight):
- `L40-41`, `L47`, `L41,91,72` — whole code lines in that tour step, by the number shown.
- `L69:inline_link_urls` — **just that text** on line 69: a box around the exact fragment.
  Prefer this whenever the line says more than the sentence does — "the page's own address"
  is `L69:source_url`, not all of line 69. (A fragment can't contain a comma.)
- `-42` — a removed line, by its old number (removed lines show no number on screen).
- `@name` — an element with `data-pt="name"`. Template items carry one automatically:
  `rules` / `bars` / `cards` / `steps` / `compare` rows by 1-based position (`@2`), `trace`
  rows by criterion id (`@AC8`), `look` rows by key (`@start`). In a custom scene, add `data-pt` yourself.
  **Several `@names` get one outline around all of them** — seven rows are one group, not
  seven boxes.

**Highlight or point — never both at the same thing.** A target is highlighted by default;
put `^` in front to **point** at it instead: the cursor (ui-narration's arrow, its 950ms glide)
moves to the target's **centre**, and nothing lights up. Highlighting a container and pointing
at something inside it is fine — `(@AC1,@AC2,^@AC8)`, `(L40-47,^L47:link.append)` — because
those are different things. The cursor appears only for `^` marks.

A target that matches nothing is a console error, so `viz verify` fails on it. Point where
the picture holds more than the eye can track — a hunk, a long table — not at things that
already arrive one per line, and not at what colour already says.

## flow

The v1 story, as a kind: a source card whose `[[words|detail]]` tokens show their details
(a link's words and its URL), an arrow labelled `via`, and the result built from the same
text. `to.mode: "drop"` — the details strike through and collapse out as the arrow fires,
and the result keeps only the words. `"keep"` — the source shows just the words (a kept
detail is as hidden as a real link's URL), and the details arrive on the other side, green.
`ask` puts the question and answer under it, where the consequence lands. Beats: line 0 the
source, line 1 the arrow and result, line 2 the question/answer and `cards`. Pointer targets:
`@from`, `@to`, `@q`, `@a`, `@card1`….

## Add-ons (addons/) — data the template can't get from a diff

`build.ts` runs these when the change has what they read and `plan.source` is a checkout
(not a saved diff); `plan.addons.<name> = false` opts out.

- **callgraph** (`python_callgraph.py`, stdlib only) — for Python production changes:
  every function the diff adds, the callers that reach it up to entry points, and the tests
  that reach it → `callgraph.json`. Node pointer names: the new function's name, others
  `<module>.<qualname>` (`@web-source-module.WebSourceModule.run`). Another language is a
  sibling script writing the same JSON.
- **fixtures** (`pdf_fixtures.py`, via `uv` with pypdf + pillow; needs `pdftoppm`) — every PDF
  the change adds: pages rendered to `fixtures/`, link annotations and malformed entries →
  `fixtures.json`. Pointer names: `@<file>` (the whole page — e.g. a link-free PDF), `@<file>-link<n>`, `@<file>-malformed`.
