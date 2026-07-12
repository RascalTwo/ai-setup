# Rich text in tldraw (ProseMirror docs)

The single most important thing to know: **in tldraw v3+, shape labels are ProseMirror JSON, not strings.** Passing a string where richText is expected will fail validation. Passing malformed JSON where richText is expected will sometimes *crash the renderer* — turning the canvas into a "Something went wrong" screen until the tab is refreshed.

Always use `window.__td.richText(str)` (or the helpers that wrap it) to build rich text. Don't hand-roll ProseMirror JSON unless you need bold/italic/links, and even then prefer the helper for bulk text.

## The minimal valid doc

```js
{ type: 'doc', content: [{ type: 'paragraph' }] }
```

This is what tldraw uses for an empty label. Every shape that has a label prop needs *at least* this — `richText: undefined` or `richText: null` is invalid.

## A single line of text

```js
{
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{ type: 'text', text: 'Hello world' }]
  }]
}
```

Produced by `td.richText('Hello world')`.

## Multiple lines (multiple paragraphs)

```js
{
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Line 1' }] },
    { type: 'paragraph' },                                                  // blank line
    { type: 'paragraph', content: [{ type: 'text', text: 'Line 3' }] }
  ]
}
```

Produced by `td.richText('Line 1\n\nLine 3')`. Blank lines become paragraphs with no content.

## What Claude should NOT do

These are real ways the skill could break the canvas:

```js
// ❌ Plain string — fails validation
{ richText: 'hello' }

// ❌ Null — fails validation
{ richText: null }

// ❌ Shape that expects richText but you pass `text` — fails validation
editor.createShape({ type: 'geo', props: { text: 'hello' } })

// ❌ Malformed doc with content on the root — may render-crash
{ type: 'doc', text: 'hello' }

// ❌ Paragraph with no `type` on its text content — may render-crash
{ type: 'doc', content: [{ type: 'paragraph', content: [{ text: 'hi' }] }] }

// ❌ Missing `content` array when you expect empty paragraph
{ type: 'doc', content: [{}] }
```

## What Claude SHOULD do

```js
// ✅ Use the helper
td.richText('Hello world')

// ✅ Or pass `text` to a create helper — it calls richText() internally
td.createBox({ text: 'Hello world' })

// ✅ Or pass `text` via updateShape shorthand
td.updateShape(boxId, { props: { text: 'New label' } })
```

## Marks (bold, italic, code)

ProseMirror supports inline marks. If the user asks for bold text specifically:

```js
{
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'normal ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' normal' }
    ]
  }]
}
```

Available marks include `bold`, `italic`, `code`, and `link` (with `attrs: { href: '...' }`). If you need this regularly, extend `scripts/bootstrap.js` with a `richTextWithMarks()` helper. For v1, plain text through `td.richText()` is enough.

## Recovering from a crashed canvas

If the page shows "Something went wrong":

1. `mcp__claude-in-chrome__navigate` with `url: 'back'` or refresh the tab.
2. Wait ~3 seconds for tldraw to load.
3. Re-inject `scripts/bootstrap.js`.
4. Call `window.__td.probe()` to confirm.
5. Retry the failed operation — but check the rich text you were passing.
