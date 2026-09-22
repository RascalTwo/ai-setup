# /viz — lite mode (no Bun, no server)

You are here because the mode check in `SKILL.md` resolved to **lite** — you can't run the
Bun toolchain, or the user chose not to install it. Everything in `SKILL.md` still applies:
the five-bar ambition test, the form menu, the kit's design language, the diagram rules.
Lite lowers the *plumbing*, never the bar.

**What lite is:** you write **one self-contained `.html` file** and hand it to the user. No
server, no hot-reload, no git history, no verify pass, no library, no publishing. Those
words should not appear in anything you say to the user in this mode — they don't exist here.

## Write one file

Name it after the thing, not the technology: `repo-import-graph.html`, not `d3-chart.html`.
Everything goes inside it — markup, styles, script, data. The user opens it by
double-clicking, or you hand it back as a downloadable artifact.

CDN imports still work (`https://esm.sh/d3@7`, `https://esm.sh/three`), because the file is
opened in a real browser. That's the one full-mode luxury lite keeps — but reach for one
only when the maths earns it. Across the corpus, hand-rolled SVG plus CSS grid is what
nearly every viz is actually made of; libraries appear in about 16 pages out of 257, and
no viz has ever used React, Vue or Tailwind.

## Inline the kit — don't reinvent it, and don't copy it into a second file

The kit is the house visual identity. Its files live in the skill directory beside this one,
and you can read them:

- **`kit/viz-kit.css` — always inline it.** Read it and paste the contents into a `<style>`
  block. That's ~12KB and it buys every token (`--accent`, `--c1`…`--c8`), plus `.panel`,
  `.legend`, `.drawer`, `.viz-header`. Re-theming is the same 6-line `:root` override
  described in `SKILL.md`.
- **`kit/viz.js` — inline it only if you actually call it.** Most lite pages need `stepper()`
  and nothing else. If you do need it: paste the source into a `<script type="module">`,
  **delete the `export ` keywords**, and put your page code below it in the same module. One
  scope, no `import` line, no import map — the `/_kit/` URLs it normally loads from do not
  exist here.
- **Set `window.__VIZ_STATIC__ = true`** before the kit runs. `vizEnv()` otherwise probes
  `/_health`, which will never answer, and you'd get "offline" instead of "static".

There is deliberately no separate lite copy of these files. Two copies of the same design
tokens drift, and then lite pages stop looking like real vizzes.

## The scaffolds still work

`deck-template.html`, `poster-template.html`, `poster-dive-template.html`,
`exchange-template.html` and `hero-template.html` sit in the skill directory. If the content
has one of those shapes — a presentation, a share card, an actors-and-packets exchange — read
the template and adapt it inline rather than rebuilding the chrome. Drop any `/_kit/` links
and inline as above. `kit/EXCHANGE.md` is the authoring guide for the exchange runtime.

## Verify it yourself

There is no `viz verify` here, so **you** are the verifier, and the five bars in `SKILL.md`
are the checklist. Before you hand the file over, walk them explicitly:

1. Point at a mark and say what its position, size or colour *means*.
2. Name the input the reader drives, and what it changes.
3. If the subject has two zoom levels, show both.
4. Every meaningful mark carries `data-viz-id` and a human `data-label`.
5. Legend, units, and a one-line "what am I looking at" are on the page.

Also check the things `viz verify` would have caught and now can't: no text overflowing its
box, no arrow pointing at empty space, no element positioned off-canvas, and no `console`
errors from a typo'd import. Re-read your own markup for these — nothing else will.

## Hand it over

Give the user the file, and one line on what it shows and what they can drive. If they ask
for changes, edit and re-emit the whole file — there is no partial reload here.

If the user is on a machine where Bun *could* be installed and they later want live data,
hot-reload or a published URL, that's full mode; point them back at `SKILL.md`.
