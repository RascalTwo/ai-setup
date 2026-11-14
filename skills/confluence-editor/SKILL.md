---
name: confluence-editor
description: "Surgically edit an existing Confluence page in Chrome (sections, text, screenshots, inline links), leaving it an unpublished draft with a review overlay that marks every change. Use for \"edit this Confluence page\", \"add a screenshot to the wiki page\", \"update the runbook\", \"show me what changed in the drafts\". Not whole-body markdown publishing (publish-markdown-to-confluence)."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    confluence: cloud editor ui
    chrome: browser automation through the browser skill (OpenCode Browse)
  requires:
    skills: [browser]
    manual: [Chrome]
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

**Every hand-back ends with the [review overlay](#hand-back-the-review-overlay)** on each draft tab: Confluence shows no diff in the editor, and by review time the human has forgotten what they approved.

This matters more than it sounds. Editor selections misbehave in ways that can delete far more
than you intended (see below); an unpublished draft makes that recoverable rather than
published.

## Prerequisites

- The **`browser` skill** (default tool: browse). It picks the tool and covers sessions, `execute`, per-action timeouts (`{ timeout: 5000 }` on every action) and screenshots; this file adds only what Confluence needs.
- The user already signed in to Confluence in their Chrome. If the editor URL lands on a login page, call `handoff()` in the script and let the user finish; never type credentials.

Every recipe below is page JS inside `page.evaluate(...)` or a Playwright call, in one `browse execute` script per sequence. `page.evaluate` runs in an isolated world: DOM, `getSelection()`, `execCommand` and dispatched events behave as on the page, but page globals are invisible. Nothing here needs a page global. (If a recipe misbehaves, run the same JS in the main world: `context.newCDPSession(page)` and `Runtime.evaluate`, as `skills/tldraw-canvas/scripts/main.sh` does.)

## Open the editor

`browse session new cf`, then in `browse execute -s cf`:

```js
await page.goto("https://<site>.atlassian.net/wiki/spaces/<SPACE>/pages/edit-v2/<PAGE-ID>", { timeout: 30000 });
```

Delete the session when you hand back (`browse session delete cf`); the draft survives it.

A "real" key or click in the recipes below means Playwright input (`page.keyboard.press("Backspace")`, `locator.click({ timeout: 5000 })`), as opposed to an event you dispatch from page JS.

## Read the CURRENT text from the editor, never from the API

The Atlassian MCP's `getConfluencePage` returns the **published** version. If the
page has unpublished changes — yours or the user's — you will read stale content and edit
against a version that no longer exists.

Read the editor tab instead: `await page.evaluate(() => [...document.querySelectorAll('.ProseMirror')].sort((a, b) => b.textContent.length - a.textContent.length)[0].innerText)`. If the API and the editor disagree, the editor
is right and the difference is an unpublished draft.

The REST v2 API does read the draft: `GET /wiki/api/v2/pages/<id>?get-draft=true&body-format=atlas_doc_format` (basic auth, email + API token) returns `status: "draft"` and the draft's ADF; without `get-draft` it returns the published version. Use it to confirm a draft autosaved, to check a draft's `version.createdAt` didn't move after an action that should not edit, and to diff draft against published.

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
  become literal text. Type the marker once, then separate items with `\n` in a single `page.keyboard.type(...)`.
- **Tab / Shift+Tab** (`page.keyboard.press`) nest and outdent list items. This is how you produce `a.` / `b.`
  sub-items under a numbered step.
- **Two Enters** exit a list.
- `Meta+Alt+0` sets the current block back to body text — needed after deleting a heading,
  or your replacement text inherits the heading style.

## Deleting safely — the part that bites

**Do not select with the mouse or with `Shift+Meta+Arrow`.** Two verified failures (seen under the previous tool, claude-in-chrome; the recipes below have not been re-run under browse):

- `shift+click` does **not** reliably extend a selection in this editor. It silently collapses
  to a caret, and the `Delete` that follows does something you did not intend.
- `Shift+Meta+ArrowRight` on the **last line of a block selects to the end of the document.**
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

**If you must delete by selection, screenshot the highlighted range before pressing Delete** (`files.path("sel.png")`, then `cp` it out and look).

## Inserting an image from disk

The editor has a hidden file input. Uploading to it inserts the media **at the caret**. browse's `setInputFiles` accepts only files under `files.dir`, so copy the image there first:

```sh
D=$(browse execute -s cf --json 'return files.dir' | jq -r .value); cp /abs/path/img.png "$D/img.png"
```

```js
// list the candidates first, then pick the one in the page editing area (check accept and ancestors)
const inputs = await page.evaluate(() => [...document.querySelectorAll('input[type=file]')].map((i, n) => ({ n, accept: i.accept, area: i.parentElement?.className })));
await page.locator('input[type=file]').nth(0).setInputFiles(files.path("img.png"), { timeout: 5000 });
```

So the pattern for "replace this placeholder with a screenshot" is:

1. clear the placeholder's contents with the `execCommand` recipe above (caret is now in the
   empty node)
2. `setInputFiles` on that input

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

One `browse execute` script can loop `delete last → setInputFiles → waitForTimeout(5000)`, one pass per placeholder. Return the remaining count from the JS so you can see the countdown in the output.

## Turning a URL into an inline page link

Typing a Confluence URL + space produces a link that displays the **raw URL**. To show the page
title instead:

1. click the link (`page.locator('a[href*="<page-id>"]').click({ timeout: 5000 })`)
2. click the floating toolbar's **`URL`** button (`page.getByRole('button', { name: 'URL' })`; read `snapshot()` if the name differs)
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
  selecting the text and pressing `Meta+i` / `Meta+b`.
- Map `root.children` before and after every paste; indices shift.

## Small in-place edits

Every recipe starts the same way: build a `Range`, add it to the selection, dispatch `selectionchange`, wait ~350ms, then act. Keep the range inside **one block**; never span lists, tasks or expands (see Gotchas).

| Edit | Recipe |
|---|---|
| Replace text | Range over the words in one text node, then a `text/plain`-only paste. Marks inside a `strong`/`em` are lost; reselect and press real `Meta+b` / `Meta+i`. |
| Delete an inline span (even across a link) | Range from the start offset in the first text node to the end of the last one, all in one block, then a real `Backspace` key. |
| Add a list item after one | Caret at the end of that `li`'s last text node, then paste `<ul><li><p></p></li><li><p>new</p></li></ul>` (match the list tag: `ol` for a numbered list). At the end of a list's last item this can join the **parent** list; check which list grew. |
| Add a paragraph after one | Caret at its end, paste `<p></p><p>new</p>`. |
| Add a decision item | Caret at the end of the last decision, real `Enter`, then paste `<span data-node-type="date" data-timestamp="<ms UTC midnight>"></span> — text` for a date chip. |
| Add table rows | Real `Tab` in the last cell adds a row; paste each cell's text, real `Tab` between cells. |

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

## Hand back: the review overlay

A layer drawn over each draft tab: a numbered arrow and a colored box on every changed block (green added, orange changed, red "check this: I deviated or chose myself"), plus a panel listing each change with its word diff, the decision behind it, the user's pick and their own words. Clicking a card scrolls to the change; checkboxes count progress. The user reviewed 12 drafts with it and asked for it every time. Files are in [`review-overlay/`](review-overlay/).

1. **Diff** every draft against its published version: `python3 review-overlay/diff_drafts.py --site <site> --email <email> --token-file ~/.atlassian-token <id>... > changes.json`. Blocks compare as text, so formatting-only changes don't show.
2. **Annotate** each item: `edit: {id, title, pick, pickLabel, said, why}` from wherever the decisions live (a grill-me-viz `data.ts`, the plan, the chat), and `note` for anything you deviated on or chose yourself. Match items to decisions by word overlap, then **read every mapping**: one sentence prefix can match two paragraphs, and a decision asked twice has two option lists; take the last round's.
3. **Build** the bundle: `python3 review-overlay/build.py changes.json > crv-bundle.js` (in the scratchpad), then `node --check` it.
4. **Load it into every tab.** The page can't fetch from localhost (CSP), but `eval` works, and `localStorage` is shared across same-origin tabs. So ship the file once, then eval it everywhere:
   Run `sh review-overlay/inject.sh <session> crv-bundle.js` (add `--target-url <substring>` to pick another open draft tab; a session can hold several, and each run picks its items by the page id in that tab's URL). It evaluates the bundle in the page and prints `crv: N items, located M`; anything under N needs a look. No file upload or `localStorage` hop is needed.
5. **Verify**: screenshot one simple page (`files.path(...)`, then `cp` out) and one with collapsed expands, then re-fetch each draft (`get-draft=true`) and confirm `version.createdAt` is unchanged; the overlay never touches the editor.

Layout and behaviour that matter:

- **The panel sits top-left, over the page tree**, below the header. Top-right covered the `Update` button and page text, and the user asked for it moved.
- Everything is appended to `document.body`, outside `.ProseMirror`, and repositioned every frame from `getBoundingClientRect`, so nothing can enter the draft.
- An item inside a collapsed expand has no box; the overlay boxes the expand's header and labels it "#N is inside — expand".
- A reload clears it. To re-inject after a fix, capture the checked boxes first and click them again afterwards, so review progress survives.

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
- **A delete range that reaches into an expand can take the whole expand.** `execCommand('delete')` from the end of a list item to the end of an item inside a JS-opened expand deleted the entire "8. Capacity & headroom report" section. A real `Meta+z` restored it; afterwards, count expands and check the section titles. To change text inside an expand, replace text within a single text node rather than deleting a range.
- **A collapsed expand hides its body from the selection:** `getSelection().toString()` is empty for text inside it. Open the expand first, and check `toString()` before acting.
- **`Meta+z` after a synthetic paste did not undo it.** Reload the edit URL to see the true saved
  draft before attempting any repair.
- **Deleting a table:** click a cell, open the floating table toolbar's `…` menu, choose `Delete`.
- **Drafts are per user and survive tab closure.** Closing the tab does not discard the work,
  and the page shows an "unpublished changes" marker to others until published or discarded.

## Tested under browse

Ported from claude-in-chrome on 2026-11-13. Run for real: the review overlay (`review-overlay/inject.sh` evaluates the bundle in a page, boxes and panel draw, `crv: 2 items, located 2` on a stand-in page). **Untested**: every editing recipe above, because the browse Chrome was not signed in to Confluence and editing creates a draft. First time you edit, check each recipe on a throwaway page and watch for isolated-world differences.

## See Also

- **browser-capture** skill — producing the images, including
  `references/sanitized-screenshots.md` for pages showing real data.
- **publish-markdown-to-confluence** skill — the whole-body, API, publish-now alternative.
