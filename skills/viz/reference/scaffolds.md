# Scaffolds — what each one gives you

Read this when you've decided a viz has one of these shapes, or when you're editing
a page that already carries a `viz:scaffold` meta. For the plain case — a blank
starter — you don't need this file.

Every scaffold composes with `--local`/`--global`, and every one carries an
authoring-guide comment inside the file it generates. `viz create` with no
arguments prints the current flag list.

## `--deck` — an arrow-key presentation

Scale-to-fit 16:9 canvas, `←/→/space` + `F` fullscreen, progress bar, `.reveal`
cascades, and reversible per-slide fragments (`.frag`). Add slides by copying a
`<section class="slide">`.

This is the one scaffold bootstrap does **not** dump to stdout — its template is
large, so read `index.html` before editing it.

## `--poster` — a viz that *is* its own share card

A fixed **1200×630** `.og-card` stamped `viz:card=self`, so `verify.ts --og` clips it
straight to `og.auto.png` with no separate `hero.html`. Keep key content in the centre
~1080×565 safe zone (`class="show-safe"` toggles a guide).

## `--poster-dive` — that card on top of a deep dive

A poster whose card is the **top** of a scrollable page rather than the whole of it:
the 1200×630 card still clips to `og.auto.png`, and everything below it is the deep
dive. Implies `--poster` and is tagged as one — a dive *is* a poster.

Spelled `--poster --dive` before 2026-08-19; the old spelling now errors.

## `--exchange` — something passed between parties

An animated diagram of something being presented, passed or proven between parties:
actors in phase bands, packets riding declared wires, stepped narration. `index.html`
bolts the shared `/_kit/exchange.js` runtime to a sibling `content.js`, which is the
only file most edits touch.

Authoring guide: `kit/EXCHANGE.md`.

## `--hero` — an add-on, not a scaffold

Adds a starter `hero.html` beside `index.html`: the 1200×630 card that unfurls when the
viz URL is shared, while the viz itself stays a normal page. Built on `/_kit/viz-og.css`,
so it re-themes with the viz.

Use it when the viz needs a card *different* from itself. `--poster` is for when the
whole page **is** the card — the two don't combine, and `--hero` never stamps
`viz:scaffold`.

## The `viz:scaffold` meta

Each scaffold stamps `<meta name="viz:scaffold" content="…">` — `poster`,
`poster-dive`, `deck`, or `exchange` — so a page *states* which scaffold generated it
instead of being inferred from its markup. **Keep the line when you edit a scaffolded
viz.** Three rules make it readable:

- **Absent means plain page.** A blank-starter viz, with or without a `--hero` card,
  carries no `viz:scaffold`.
- **A dive declares itself, not its parent.** `--poster-dive` stamps `poster-dive`, not
  `poster`. Ask "is this a poster?" with a `poster` **prefix** test — dive-ness is
  derivable from the scaffold name, but the scaffold name is not recoverable from a
  flattened `poster`.
- **It is not "what I forked from."** Any viz can seed a new one via `--from`, so
  *templating* is agnostic — that's why this meta is named for the built-in **scaffold**,
  not for a template. A `--from` fork inherits the value along with the rest of the head,
  which is correct: a fork of a deck is still a deck. `--from` records no provenance link
  to its source; if you ever want one, that's a separate meta.

Why 1200×630 specifically, and the rest of the card pipeline: `reference/publishing.md`.
