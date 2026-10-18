# Fonts

The kit ships **system stacks** — `--sans` and `--mono` in `kit/viz-kit.css`. No
network, no FOUT, instant render. They are the right default and most vizzes should
leave them alone. About 5% of the corpus (13 of 251) wanted a real typeface.

## The pattern

Eleven of those thirteen already do exactly this — three lines in `<head>`, then
override the two kit tokens:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap">
```

```css
:root {
  --sans: 'Lato', 'Segoe UI', system-ui, -apple-system, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
```

This is the kit's **re-theme, don't fork** rule applied to type. Every kit component
reads through `var(--sans)` / `var(--mono)`, so overriding those two tokens re-types the
entire page — headings, labels, SVG text, code blocks, meters — and nothing else is
touched.

**Keep the system stack as the fallback tail.** With `display=swap` (in every corpus
URL) text paints in the fallback before the webfont arrives, so the kit stack *is* the
first frame the reader sees. Dropping it means that frame is a browser default instead.

## Anti-pattern

Setting `font-family` on `body` or on individual rules instead of overriding the tokens.
Two vizzes do this (`technically-speaking-pr`, `seating-chart-hackathon-slides`). The
result: kit components that resolve `var(--sans)` keep the system stack while
hand-written rules get the webfont, so the page renders in two typefaces and the seam
shows wherever kit and custom markup sit side by side.

## What's been used

| pairing | vizzes |
|---|---|
| **Lato + JetBrains Mono** | 10 — the de facto house webfont |
| Roboto / Roboto Condensed + Roboto Mono | 1 |
| Oswald + Inter | 1 |

Take the Lato pairing unless the viz has a reason to differ — a client's brand, a
deliberate period look, a poster that needs a display face. "I fancied something else"
is not a reason; it just makes the corpus less coherent.

## Cost

Each family+weight combination is a render-blocking request. Ask for the weights you
actually use — `wght@400;700` is two, `wght@300;400;700;900` is four, and the corpus
URLs mostly over-ask out of copy-paste.
