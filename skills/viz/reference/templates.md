# Templates — starting a viz from one

Read this before creating a viz with a known shape (a deck, a share card, an exchange),
when making a new template, or when editing a page that carries `viz:template` or
`viz:page-kind`. For a plain page you don't need it.

## The rule: look before you create

**Before `viz create`, run `viz templates <kind>`** for the kind you're about to build
(`viz templates` alone lists every kind).

- **None fits** → `viz create <slug>` (the blank starter) and the kit.
- **One fits** → offer it: `viz create <slug> --from <name>`.
- **More than one fits** → **ask the user which.** Name each, with its description.
  Never pick silently: a branded template and the plain built-in both say `deck`, and only
  the user knows which audience this is for.

Skipping this step is how a brand deck gets redrawn from memory — partially — instead of
copied whole.

## What a template is

An **ordinary viz** whose head declares what it is a template for:

```html
<meta name="viz:template" content="deck">
```

That value is its **kind**. Kinds are open: any template can declare a new one, and
`viz templates <kind>` filters on it. A template's **name** is its folder name.

- `viz create <slug> --from <name>` copies it. The name must match **exactly one**
  template; if two share it, the command refuses and lists their paths — pass the path
  instead. `--from <path>` also forks any viz at all, template or not.
- The copy is a new viz: posture reset to `local`/`unlisted`, new `viz:uid`, `<title>`
  and `viz:title` set to the slug. It carries **`viz:page-kind="<kind>"`** in place of
  `viz:template` — a deck made from a deck template is a deck, not another template.
- Every template carries its authoring guide as comments inside its own files, so the
  guidance travels into each copy. **Read a copy before editing it.** `create` dumps a
  small page to stdout; a large one (a deck) it tells you to read instead.

**Making one:** add the `viz:template` meta to a viz — that's all. Write its
`viz:description` as *when to use it*; that is what `viz templates` shows and what the
user chooses between. It is found wherever it lives: the skill's bundled `viz-pages/`,
the central library, or any repo's `viz-pages/` under your home directory. `viz templates`
rescans your home for new `viz-pages/` folders every time (a few seconds), so a template in a
repo you cloned a minute ago is listed; `--from <name>` rescans once if the name isn't found.

## The built-in templates

They ship in the skill's bundled `viz-pages/`, next to the self-portrait.

### `deck` — an arrow-key presentation

Scale-to-fit 16:9 canvas, `←/→/space` + `F` fullscreen, progress bar, `.cascade`
entrances, and reversible per-slide fragments (`.frag`). Add slides by copying a
`<section class="slide">`.

Runs on reveal.js through `/_kit/deck.js` (`reference/cdn.md` has why and the gotchas),
so it also gets: speaker notes as `<aside class="notes">` inside a slide and `S` for the
speaker view; `O` overview; `B` black screen; `#/3` deep links; and `?print-pdf` on the URL,
then print to PDF, for one page per slide. `reveal` is a reserved class in a deck.

### `poster` — a viz that *is* its own share card

A fixed **1200×630** `.og-card` stamped `viz:card=self`, so `verify.ts --og` clips it
straight to `og.auto.png` with no separate `hero.html`. Keep key content in the centre
~1080×565 safe zone (`class="show-safe"` toggles a guide).

### `poster-dive` — that card on top of a deep dive

A poster whose card is the **top** of a scrollable page rather than the whole of it:
the 1200×630 card still clips to `og.auto.png`, and everything below it is the deep
dive. Its kind is `poster-dive`, not `poster`: ask "is this a poster?" with a `poster`
**prefix** test — dive-ness is derivable from the kind, but not recoverable from a
flattened `poster`.

### `exchange` — something passed between parties

An animated diagram of something being presented, passed or proven between parties:
actors in phase bands, packets riding declared wires, stepped narration. `index.html`
bolts the shared `/_kit/exchange.js` runtime to a sibling `content.js`, which is the
only file most edits touch. Check it with `viz check <folder>` before opening a browser.

Authoring guide: `kit/EXCHANGE.md`.

## `--hero` — an add-on, not a template

`viz create <slug> --hero` adds a starter `hero.html` beside `index.html`: the 1200×630
card that unfurls when the viz URL is shared, while the viz itself stays a normal page.
Built on `/_kit/viz-og.css`, so it re-themes with the viz. It composes with any
template, except one whose page is already its own card (`viz:card=self`, i.e. a
poster) — there it is ignored, with a note.

## The kind metas

- **Absent means plain page.** A blank-starter viz, with or without a hero, has no kind.
- **Keep the line when you edit** — it is how the lobby and the self-portrait group
  pages.
- `viz:scaffold` is the pre-template name, still on older pages and still read. A copy
  made from one is normalised to `viz:page-kind`.
- **Not `viz:kind`.** That name belonged to the explanatory/operational axis ADR 0011
  removed; unswept pages still carry it, and nothing reads it.

Why 1200×630 specifically, and the rest of the card pipeline: `reference/publishing.md`.
