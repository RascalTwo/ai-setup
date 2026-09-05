---
name: confluence-editor
description: Make surgical edits to an existing Confluence page by driving the Confluence Cloud editor in Chrome - insert or replace a section, swap text, add screenshots and images, convert a pasted URL into an inline page link - and leave the result UNPUBLISHED as a draft for the human to review and click Update. Use when the user says "edit this Confluence page", "add a screenshot to the wiki page", "fill in that section", "update the runbook", "put this in the page but don't publish", or asks for changes to a page they will review themselves. Do NOT use to publish a whole markdown file over a page body - that is publish-markdown-to-confluence.
---

Drive the Confluence Cloud editor as a human would, for changes too surgical to express as a
whole-page replacement.

## Choosing between this and `publish-markdown-to-confluence`

| | this skill | publish-markdown-to-confluence |
|---|---|---|
| Mechanism | browser, the real editor UI | Atlassian MCP, ADF via API |
| Scope | one section, one paragraph, one image | the entire page body |
| Result | **unpublished draft** | published immediately |
| Use when | the human authored the page and will review | the markdown file is the source of truth |

If the page is generated from a local file, use the other skill. If a human owns the page and
you are contributing to it, use this one.

## The default: do not publish

**Never click `Update`** unless the user explicitly asks you to. Confluence autosaves the draft
(the header switches to "Saved"), which is the desired end state: the human opens the tab,
reads the diff, and publishes. Say so when you hand back.

This matters more than it sounds. Editor selections misbehave in ways that can delete far more
than you intended (see below); an unpublished draft makes that recoverable rather than
published.

## Prerequisites

- Chrome MCP tools loaded — `navigate`, `computer`, `find`, `read_page`, `javascript_tool`,
  `file_upload`, `browser_batch`. Load them in ONE `ToolSearch` call.
- The user already signed in to Confluence in their Chrome.

## Open the editor

```
https://<site>.atlassian.net/wiki/spaces/<SPACE>/pages/edit-v2/<PAGE-ID>
```

## Read the CURRENT text from the editor, never from the API

`mcp__claude_ai_Atlassian_Rovo__getConfluencePage` returns the **published** version. If the
page has unpublished changes — yours or the user's — you will read stale content and edit
against a version that no longer exists.

Use `get_page_text` on the editor tab instead. If the API and the editor disagree, the editor
is right and the difference is an unpublished draft.

Reloading the edit-v2 URL pulls the current server-side draft, so a stale tab is fixed by
navigating to it again.

## Typing: markdown autoformats as you type

Confirmed working in the editor:

| Type | Produces |
|---|---|
| `## ` / `### ` | Heading 2 / 3 |
| `* ` | bullet list |
| `1. ` | ordered list |
| `_italic_` | italic |
| `` ` ``code`` ` `` | inline code, and typing continues in normal text after the closing backtick |
| ```` ``` ```` | code block |
| a bare URL + space | link |

- Inside a list, **Enter continues the list** — do not prefix later items with `* ` or they
  become literal text. Type the marker once, then separate items with `\n` in a single `type`.
- **Tab / shift+Tab** nest and outdent list items. This is how you produce `a.` / `b.`
  sub-items under a numbered step.
- **Two Enters** exit a list.
- `cmd+alt+0` sets the current block back to body text — needed after deleting a heading,
  or your replacement text inherits the heading style.

## Deleting safely — the part that bites

**Do not select with the mouse or with `shift+cmd+Arrow`.** Two verified failures:

- `shift+click` does **not** reliably extend a selection in this editor. It silently collapses
  to a caret, and the `Delete` that follows does something you did not intend.
- `shift+cmd+ArrowRight` on the **last line of a block selects to the end of the document.**
  In one session this deleted an entire section and two large tables that were nowhere near
  the target. It was caught only because a screenshot was taken afterwards.

Select programmatically instead. This is precise, needs no coordinates, and cannot overshoot:

```js
const root = document.querySelector('.ProseMirror');
const el = /* the <p> or <li> you want to clear */;
el.scrollIntoView({ block: 'center' });
root.focus();
const r = document.createRange();
r.selectNodeContents(el);
const s = window.getSelection();
s.removeAllRanges();
s.addRange(r);
document.execCommand('delete');
```

`execCommand('delete')` is deprecated but works, leaves the caret in the now-empty node, and
went 11-for-11 with zero misfires where coordinate-based selection had already failed twice.

**If you must delete by selection, screenshot the highlighted range before pressing Delete.**

## Inserting an image from disk

The editor has a hidden file input. Uploading to it inserts the media **at the caret**.

```
find: "page editing area hidden file input"   ->  ref
file_upload: { paths: ["/abs/path/img.png"], ref, tabId }
```

So the pattern for "replace this placeholder with a screenshot" is:

1. clear the placeholder's contents with the `execCommand` recipe above (caret is now in the
   empty node)
2. `file_upload`

Allow ~5s per image before the next edit; the media node renders asynchronously.

Produce the image first with the **browser-capture** skill — and if the page shows real
identifiers, its `references/sanitized-screenshots.md`.

### Replacing many placeholders in one pass

Work **bottom-up** so earlier positions do not shift, and re-query each time rather than
caching a list:

```js
const ps = Array.from(document.querySelector('.ProseMirror').querySelectorAll('p'))
  .filter(e => e.textContent.includes('SCREENSHOT'));
const el = ps[ps.length - 1];   // always the last remaining
```

`browser_batch` accepts `file_upload`, so one batch can do
`wait → javascript(delete last) → file_upload` twice over. Return the remaining count from the
JS so you can see the countdown in the tool output.

## Turning a URL into an inline page link

Typing a Confluence URL + space produces a link that displays the **raw URL**. To show the page
title instead:

1. click the link
2. `find` the floating toolbar's **`URL`** button and click it
3. choose **`Inline`**

`Card` and `Embed` are the other options; `Inline` is what matches ordinary in-page links.

## Verify structurally, not visually

List markers render in ways that make a correct document look wrong — an image inside list item
`b.` can paint with the `b.` marker on its own line, looking like a leftover empty bullet. Check
the DOM before "fixing" it:

```js
const img = document.querySelector('.ProseMirror img[alt*="my-file"]');
const li = img.closest('li');
JSON.stringify(Array.from(li.parentElement.children)
  .map(c => ({ text: c.textContent.trim().slice(0,40), hasImg: !!c.querySelector('img') })));
```

A final sweep worth running before handing back: count remaining placeholders and list inserted
images in document order, to confirm nothing was missed or transposed.

## Gotchas

- **The API shows the published page, the editor shows the draft.** Covered above; it is the
  single easiest way to waste a cycle.
- **`Escape` and stray clicks can select a media node** rather than placing a caret. A
  `Backspace` at that point deletes the image. If the image gains a blue border and a caption
  prompt, it is node-selected — press `ArrowRight` to collapse, do not press Backspace.
- **Clicking the editor's empty margin does not focus it.** Click into existing text.
- **Confluence macros regenerate on publish.** A stale Table of Contents listing a heading you
  removed is expected and fixes itself on Update.
- **Drafts are per user and survive tab closure.** Closing the tab does not discard the work,
  and the page shows an "unpublished changes" marker to others until published or discarded.

## See Also

- **browser-capture** skill — producing the images, including
  `references/sanitized-screenshots.md` for pages showing real data.
- **publish-markdown-to-confluence** skill — the whole-body, API, publish-now alternative.
