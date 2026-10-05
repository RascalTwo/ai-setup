---
name: confluence-editor
description: "Surgically edit an existing Confluence page in Chrome (sections, text, screenshots, inline links), leaving it an unpublished draft for human review. Use for \"edit this Confluence page\", \"add a screenshot to the wiki page\", \"update the runbook\". Not whole-body markdown publishing (publish-markdown-to-confluence)."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    confluence: cloud editor ui
    chrome: browser automation
  requires: [chrome, claude-in-chrome]
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

Select programmatically instead. This is precise, needs no coordinates, and cannot overshoot.

**Find the page body by its content, not by `querySelector('.ProseMirror')`.** On a new page the
Rovo "Describe or select what you want to create" box is also a `.ProseMirror` and comes *first*
in the DOM. In one session a whole page body was pasted into it, a stray key submitted it, and Rovo
started generating and renamed the page before it could be cancelled. Every recipe below assumes:

```js
const root = [...document.querySelectorAll('.ProseMirror')]
  .find(p => p.textContent.includes('/* text you know is on the page */'));
```

```js
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
const ps = Array.from(root.querySelectorAll('p'))
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

## Replacing whole blocks: paste HTML

For rewriting a section — paragraphs, lists, headings, a table — typing is slow and autoformat
fights you. Dispatch a synthetic paste instead; the editor parses the HTML into real nodes:

```js
const paste = (html) => {
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  dt.setData('text/plain', html.replace(/<[^>]+>/g, ''));
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
};
// select top-level blocks a..b of root.children, then:
root.focus();
const r = document.createRange();
r.setStart(root.children[a], 0);
r.setEnd(root.children[b], root.children[b].childNodes.length);
getSelection().removeAllRanges(); getSelection().addRange(r);
document.dispatchEvent(new Event('selectionchange'));
await new Promise(x => setTimeout(x, 300));   // let the editor adopt the selection
paste('<p>…</p><h2>…</h2><ul><li><p>…</p></li></ul>');
```

What decides the result:

- **Without the `selectionchange` + short wait, the editor ignores your selection** and pastes at
  its own — in one session that replaced the page's intro paragraph instead of the target.
- **Pasting into a single selected paragraph keeps it a paragraph.** `<h2>` or a `<table>` pasted
  there arrives as plain text. Select a range spanning *whole* blocks, or start the paste in a
  block the new content can replace.
- **Strip newlines between tags** in the HTML string. Whitespace text nodes between blocks can
  flatten headings and tables into paragraphs.
- **Leading spaces and marks are dropped** from pasted fragments, and a fragment pasted inside
  `<em>` inherits the italics. Insert a lone space with a `text/plain`-only paste; fix a mark by
  selecting the text and pressing `cmd+i` / `cmd+b`.
- Map `root.children` before and after every paste; indices shift.

## Verify structurally, not visually

List markers render in ways that make a correct document look wrong — an image inside list item
`b.` can paint with the `b.` marker on its own line, looking like a leftover empty bullet. Check
the DOM before "fixing" it:

```js
const img = root.querySelector('img[alt*="my-file"]');
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
- **Typing a date like `7/31/2026` autoformats into a date lozenge** — with the wrong year in one
  session — and swallows the next `Enter`. Never type dates; paste them as text.
- **After a paste, a "Paste actions" (Rovo) menu opens and captures `Enter`.** Press `Escape`
  first. `Enter` after a JS-placed caret was also unreliable; a real click to place the caret,
  then `Enter`, worked every time. Check the caret with `getSelection()` before pressing keys.
- **Do not `execCommand('delete')` across task (checkbox) items.** It split a task instead of
  removing it and left the DOM out of sync with the saved draft. Clear the text with real
  `Backspace` presses from a clicked caret, then one `Backspace` per empty task, checking after
  each.
- **`cmd+z` after a synthetic paste did not undo it.** Reload the edit URL to see the true saved
  draft before attempting any repair.
- **Deleting a table:** click a cell, open the floating table toolbar's `…` menu, choose `Delete`.
- **Drafts are per user and survive tab closure.** Closing the tab does not discard the work,
  and the page shows an "unpublished changes" marker to others until published or discarded.

## See Also

- **browser-capture** skill — producing the images, including
  `references/sanitized-screenshots.md` for pages showing real data.
- **publish-markdown-to-confluence** skill — the whole-body, API, publish-now alternative.
