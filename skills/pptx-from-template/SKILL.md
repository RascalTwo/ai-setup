---
name: pptx-from-template
description: Build a new PowerPoint deck locally from a .pptx template - a talk, a client readout, an internal presentation - by filling the template's own designed slides with new content, so fonts, colors and artwork stay exactly as designed. Also maps a new template so it can be used. Use when someone asks for a slide deck, a presentation, "help me build slides", wants an outline turned into on-brand slides, or wants to set up a PowerPoint/Google Slides template for deck building.
---

# PowerPoint from template

Takes a PowerPoint template and lets you build new decks from it locally. The
presenter answers a handful of questions, approves an outline, and gets a `.pptx`
made of the template's own slides - copied, filled, and pruned. No design is invented.

**The template does the design work.** Your job is narrative, slide-pattern choice,
and staying inside the template's rules - not inventing layouts.

## Template packs

Each usable template is a **pack**: a folder, kept wherever its owner keeps it, holding:

| File | What it is |
|---|---|
| `template.pptx` | The template itself |
| `patterns.json` | The map: for each slide type (pattern), which template slide to copy and which box, paragraph range (`paras`) or picture each field fills |
| `README.md` | What each pattern is for, deck-shape defaults, how to refresh the template |
| `brand.md` | Optional: palette, contrast rules, known template flaws |
| `test_pack.py` | Optional: regression checks for this pack |

No pack ships with this skill. The person names the pack folder, or it's in the
request (e.g. "use the SA template in ai-setup-private"); if not, ask for the path.
Every script takes it as `--template PATH`, and `deck.json` as `"template"`. Before writing any slide content, read the
pack's `README.md` and `brand.md` - pattern names, defaults and color rules differ per
template.

A template with no pack yet needs mapping first - see [Mapping a new template](#mapping-a-new-template).

## Flow

### 1. Interview - keep it to one round

Ask these five, numbered, in a single message. Offer a recommended answer for each
so a non-technical presenter can just say "yes to all".

1. **Who's in the room?** (conference talk, client exec, internal team, mixed)
2. **How long is the slot?** Budget roughly one slide per minute, minus Q&A.
3. **What's the one thing they remember a week later?** One sentence. If they give
   three, push back until it's one.
4. **What should they do next?** The close depends on this.
5. **What already exists?** A doc, an old deck, a blog post, a napkin. Link or paste.

Also settle **which template pack** - its folder path.

Do not proceed on guesses. If an answer is missing, ask once more, then state the
assumption you're using and continue.

### 2. Outline - get approval before building

Write the outline as a numbered list: slide number, the **pattern name** from the
pack, the headline, and one line of what's on it. No slide bodies yet. Apply the
pack's deck-shape defaults from its `README.md`.

Show it. Ask for changes. **Do not build until they say go.** Reordering an outline
costs a sentence; reordering a built deck costs the whole deck.

### 3. Deck spec

Convert the approved outline to `deck.json`:

```json
{
  "template": "~/path/to/packs/source-allies",
  "slides": [
    { "pattern": "title",
      "fields": { "title": "How We Cut Deploy Time 80%", "subtitle": "Jane Doe - DevOpsDays" },
      "notes": "Introduce myself. Thank the organizers." },
    { "pattern": "bullets",
      "fields": { "title": "Where the Time Went", "lead": "Raise your hand if:",
                  "bullets": ["Manual approval gates", "Serial test suites"] },
      "notes": "Ask for hands. Wait for it." }
  ]
}
```

**The pack's `patterns.json` is the authoritative list of patterns and field names**,
and says which fields take a list of lines and which take one. Field kinds:

- **Text** - a string; a **list field** takes a list and grows or shrinks to fit.
  Omitting an optional field removes its line cleanly - unless the map marks it
  `keep_if_missing`, in which case the template's own text (or picture) stays. Use that
  for sensible defaults, like the SA core-values headings.
- **Image** - a file path relative to `deck.json`. Crop to the frame's shape first;
  the pattern's `desc` gives it. Omitting an optional image removes the template's
  own picture, so placeholder photos never ship.
- **Table** - `rows`, a list of `[term, definition]`; the table resizes.
- **`labels`** - text for boxes whose position the pattern owns (timeline captions,
  sticky notes). Checked against WCAG AA; a failing pair stops the build.
- **`icons`** - `[[shape id, "caption"], ...]`, ids from the pack's icon sheet (icon-row slide types).
- **Icon slot** - `"slide:shape"`, any picture from any template slide (e.g. `"31:661"` from the
  pack's icon sheet), placed into a square slot the pattern defines. The icon keeps its
  proportions. Optional slots can be left out.

Content rules, enforced while writing the spec:

- **Max 5 bullets a slide, max ~12 words a bullet.** Over that, split the slide.
- No paragraphs on a slide. Prose goes in `notes`.
- Never invent a metric, a client name, or a quote. If the presenter didn't say it,
  it doesn't go on a slide.
- A published case study that says "one of our clients" stays anonymous on the slide,
  even when internal data names the client.

**`deck.json` is the source of truth.** Rebuilding regenerates the whole deck, so
hand edits made to the `.pptx` afterwards are lost on the next build. Say so when
you hand a deck over.

### 4. Build

```bash
python3 scripts/build.py deck.json --out deck.pptx
```

Python 3 only - no pip install. The script copies the template slide behind each
pattern (duplicating it when a pattern repeats), replaces only the content, and drops
artwork no surviving slide uses. It refuses to build on an unknown pattern, a
missing required field, a list handed to a single-line field, or a failing contrast
pair, rather than quietly shipping a broken slide.

### 5. Look at it

Render and look before handing back - text overflow and leftover template content
only show up visually:

```bash
soffice --headless --convert-to pdf deck.pptx && pdftoppm -r 45 -png deck.pdf page
```

Check, and report in the handback:

- [ ] No template placeholder text or placeholder pictures survived - grep the slide
      XML for the template's sample copy; decode any QR codes
- [ ] No text spilling out of its box
- [ ] Every slide has speaker notes
- [ ] The pack's own rules (its `README.md` / `brand.md` checklist)

### 6. Deliver

Hand over the `.pptx`. If they want Google Slides, upload it **with conversion** so it
lands as a native, editable Slides file - e.g. `rclone copyto deck.pptx "gdrive:<name>.pptx"
--drive-import-formats pptx`, a Drive connector with target mime type
`application/vnd.google-apps.presentation`, or by hand via **Google Slides -> File ->
Import slides**. Give them the link plus two lines on what you built and assumed.

## Mapping a new template

Mapping is one-time work per template; after it, decks just build. The script
drafts, you refine, the person reviews.

**The friendly way - Map Studio.** Start it and open the page:

```bash
python3 scripts/map_studio.py PACK_FOLDER...   # http://127.0.0.1:8765, local only
```

It lists the packs you gave it; an unmapped one gets a **Draft a map** button. The whole
recipe is drawn on the slide and listed in plain words, each step undoable: removed
shapes (hatched red), moved shapes (from-box, arrow, new position), added text boxes,
icon slots, icon rows and generated areas. The Proof tab shows the finished slide. For each
slide type it shows the real template slide with every mapped field drawn on it
(dashed boxes are unmapped - click one to add it, or mark it "remove from every deck"),
an editor for names, paragraph ranges and list/optional switches, a **Save and show
proof** button that renders the slide with each box showing its own `[field name]`,
and a **Reviewed** switch. Save reports map problems (missing shapes, two fields on
one paragraph) in a banner. The first save keeps `patterns.before-studio.json` as an
untouched copy. Slide pictures and proofs need LibreOffice and poppler; without them
the stage shows shape outlines only.

Walk the person through it rather than editing JSON for them when they want to own
the review. The same steps by command line:

1. **Pack folder:** a new folder (`PACK` below) with the template saved as `template.pptx`
   (from Google Slides: **File -> Download -> Microsoft PowerPoint (.pptx)**).
2. **Draft:** `python3 scripts/map_template.py PACK/template.pptx --out
   PACK/patterns.json`. Deterministic - no AI, same output every run. It
   finds text boxes, groups paragraphs into single-line and list fields by their
   styling, flags one-off pictures as image fields and finds tables. Empty
   placeholders (PowerPoint-style templates) become fields named by their placeholder
   type - `title`, `subtitle`, `body`, `content` - using the layout's position; a
   content box taller than about an inch becomes a list. It finds nearly every real
   box but over-maps badly: on the SA template it found 74 of 75 human-mapped fields,
   plus 84 that shouldn't be fields (mostly on reference slides).
3. **Refine (you, the agent):** turn the draft into what a careful reviewer would
   write - the judgement calls in step 5, made by you. Render the template
   (`soffice --headless --convert-to pdf` + `pdftoppm`) and look at every slide; read
   `build.py` for everything the map can express. Write `REFINE-NOTES.md` in the pack:
   one line per pattern on what you changed, plus the calls you were unsure of - that
   list is the person's review agenda. On the SA template this pass took the draft to
   71 of 75 human-mapped fields with 5 extras (from 84), same safety checks passing.
   It won't invent features the person hasn't asked for (icon slots, say) - ask.
4. **Prove:** `python3 scripts/build.py --proof --template PACK --out proof.pptx`
   builds one slide per pattern with every box showing its own `[field name]` and
   every image field in magenta; the notes list each mapping.
5. **Review with the person, slide by slide, next to the template** - starting
   from `REFINE-NOTES.md`'s unsure list. What the script can't know: what a slide is *for* (rename `slide-3` to `speakers`), good field
   names, fixed-content slides (set `fields` to `{}`), decoration flagged as a photo
   slot (a logo, a check mark - delete the field), placeholder content that isn't
   obviously a placeholder (a stranger's QR code, a client screenshot - `drop` it),
   and text colors that fail contrast (`color`). Repeat 4-5 until the proof is boring.
6. **Lock in:** `build.py --check-template --template PACK` and `test_build.py PACK`
   pass; write the pack's `README.md`.

## Known limits

- **One template slide per deck slide.** A deck slide is a copy of one template slide,
  changed by its recipe. Pictures can be pulled in from other slides only through icon
  slots a pattern defines.
- **Picture placeholders** (PowerPoint's "click to add picture" boxes), charts and
  SmartArt are not fillable yet.
- **Speaker notes need a notes page in the template.** Without one the build warns and
  writes the deck without notes; add a speaker note to any template slide and re-export.
- **Rebuilds replace hand edits** - `deck.json` is the source of truth.

## Maintenance

```bash
python3 scripts/test_build.py PACK...                    # every pattern, end to end
python3 scripts/build.py --check-template --template PACK  # the map still matches its template
python3 scripts/map_template.py --compare --template PACK  # how much of a reviewed map the script re-derives
python3 scripts/map_studio.py PACK...                      # review / fix a map in the browser
```

After re-exporting a template, run `--check-template` and fix anything it reports
before building. A raw export nobody has checked is how a broken deck reaches a client.
