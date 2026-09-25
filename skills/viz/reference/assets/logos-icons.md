# Logos and icons

## Vendor and product logos — `gilbarbara/logos`

Several hundred brand SVGs served straight off jsDelivr's GitHub mirror. Used in the
corpus for a backend logo wall:

```js
const GB = "https://cdn.jsdelivr.net/gh/gilbarbara/logos/logos";
// GB + "/aws-s3.svg", GB + "/microsoft-azure.svg", GB + "/terraform.svg"
```

Names are the kebab-case product name. Full index:
<https://github.com/gilbarbara/logos/tree/main/logos>

**Two gotchas, both verified 2026-09-05:**

1. **Aspect ratios are wildly inconsistent** — `terraform.svg` is the wordmark at
   512×123, `aws-s3.svg` is square at 256×256, `google-cloud.svg` is 256×206. A logo
   wall that sets a fixed width gets wordmarks dwarfing icons. Constrain **height** and
   let width run, or set `max-width`/`max-height` on a fixed-size flex cell.
2. **The `-icon` suffix exists for some products and not others.** `terraform-icon.svg`
   is a real 256×291 square mark; `google-cloud-icon.svg` is a 404. Check before
   assuming a square variant exists — a 404 here is a broken image, not a blank page.

These are **full-colour brand marks**. They carry their own fills and will not honour
kit tokens — that's correct for a logo (a recoloured AWS logo isn't the AWS logo), but
it means they sit outside your palette. Give them room rather than trying to blend them.

## Monochrome brand marks — `simple-icons`

```
https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/<slug>.svg
```

Single-path, no `fill` attribute, 24×24 — so **inlined** into the document it inherits
`currentColor` and takes kit tokens like any other mark. Pull it with `fetch` and inject
the path; as an `<img src>` it renders flat black and you lose the point.

Unused in the corpus so far, but it's the right tool when you want brands to read as
*your* categorical colours rather than a wall of competing brand palettes — a matrix, a
legend, a small multiple.

## UI icons (arrows, chevrons, checks, warnings)

Hand-roll them. A `<path>` is ~40 bytes, inherits `currentColor` for free, and needs no
request. An icon library for six glyphs is three round-trips to avoid typing three
paths.
