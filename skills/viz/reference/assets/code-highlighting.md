# Code syntax highlighting

## First — do you need it?

For one or two short snippets, **no**. Wrap the few tokens that carry meaning in spans
coloured with kit variables (`--accent` for the identifier under discussion, `--faint`
for noise) and stop. That reads *better* than full highlighting, because a viz shows
code to make one point and rainbow syntax colour buries it.

Reach for a highlighter when the viz shows substantial code the reader will actually
read — a diff walkthrough, a file tour, a generated-output panel.

## highlight.js

Two vizzes use it, pinned at 11.9.0 on cdnjs:

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/dockerfile.min.js"></script>
```

**The core bundle only carries common languages.** Anything outside that set is a
separate `languages/<lang>.min.js` — which is exactly why the corpus loads `dockerfile`
explicitly. If highlighting silently does nothing, a missing language file is the first
thing to check.

`atom-one-dark` is the theme in use and sits well against `--bg`. It brings its own
palette, so code blocks will not match kit categorical colours — keep highlighted code
visually separate (a panel, a card) rather than interleaved with token-coloured marks.

These are classic `<script src>` tags, not modules: they populate a global `hljs` and
must run before the code that calls it.
