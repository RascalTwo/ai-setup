# Sanitized stills for documentation

For screenshots that go **into a document** — a runbook, a wiki page, an onboarding guide —
rather than into a demo. The distinguishing problem is that the page in front of you shows
real account IDs, real queue names, real email addresses and a real logged-in user, and the
surrounding prose uses placeholders like `ACCOUNT-ID`. A raw screenshot contradicts the text
it sits next to and leaks identifiers into a page that may later be exported or widened.

Verified end to end on 12 AWS console screenshots for a Confluence runbook.

## You do not need the MediaRecorder rig

`SKILL.md`'s Route 1 exists to capture **motion**. For a still, the whole
arm/raise/click/park/stop choreography is wasted effort.

```
computer: screenshot with save_to_disk: true
```

returns a real path (`/var/folders/.../claude-chrome-screenshots-XXXX/screenshot-<ts>-<n>.jpg`)
that `ffmpeg`, `sips` and `Read` all open directly. Confirmed 18/18 times in one session.

> `gotchas.md` used to claim `save_to_disk:true` "writes no findable file". That was true once
> and is not any more. Do not route around it.

Full pipeline for one still: **navigate → sanitize the DOM → draw the box → park the cursor →
capture → crop → insert.**

## Sanitize before you capture, not after

Editing pixels afterwards means blur boxes, which look redacted and draw the eye to exactly
what you hid. Editing the DOM first produces an image that looks like an ordinary screenshot
of an ordinary account.

### The replacement pass

Walk text nodes and substitute. Do it on `document.body` so the breadcrumb, the page title,
the ARN panel and the account chip in the top-right all get caught in one pass — those are
the places a real identifier survives when you only fix the table.

```js
const pairs = [
  ['orders-worker-dead-letter.fifo',      'QUEUE-NAME'],
  ['000000000000',                        'ACCOUNT-ID'],
  ['Example Corp Dev',                    'ACCOUNT-NAME'],
  ['AdministratorAccess',                 'ROLE-NAME'],
  ['you@example.com',                     'EMAIL@example.com'],
  [/sha256:[0-9a-f]+/g, 'sha256:IMAGE-DIGEST'],
];
const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
const nodes = []; while (it.nextNode()) nodes.push(it.currentNode);
nodes.forEach(n => {
  let t = n.nodeValue;
  for (const [k, v] of pairs) t = k instanceof RegExp ? t.replace(k, v) : t.split(k).join(v);
  n.nodeValue = t;
});
```

**The left column above is fabricated.** Yours will hold the real queue, account and email you
are replacing — which is exactly why this snippet must never be pasted back into a public
repo with your values still in it. This file shipped a real account ID for a month that way.

**Use the same placeholder tokens the surrounding prose uses.** The screenshot and the
sentence above it should agree literally.

### Delete rows, don't blur them

Remove every row that isn't the subject, then rename the survivor. If the step needs to show
"one of these has a non-zero value", keep five or six neighbours and rename them
`QUEUE-NAME-1…6` — the reader still sees a list to scan, and nothing real is in it.

### Then fix the counters, or the deletion is obvious

A heading reading `Queues (25+)` above a seven-row table is the tell. The count usually lives
in its **own element**, not in the same text node as the label — a substring replace on
`"Queues (25+)"` silently does nothing. Match the count on its own:

```js
nodes.forEach(n => { if (/^\s*\(\d+\)\s*$/.test(n.nodeValue)) n.nodeValue = '(7)'; });
```

Blank free-text columns the same way (`Description` → `-`).

### Numbers inflated by your own investigation

If you polled a queue or re-ran a job while exploring, counters reflect *your* activity, not
the reader's. An SQS `Receive count` read 3 for a real consumer failure and 12 after manual
polling. Set it to the number a reader would actually see, and **tell the user you did** —
it is a value you authored, not one you observed.

## Box the control, not the container

The `ui-narration` overlay already draws the box (`#ff7a00`) and works fine for stills, not
just for narrating video. If you only need the box, this is the whole of it:

```js
const r = el.getBoundingClientRect(), p = 7;
const d = document.createElement('div');
d.id = '__hl_' + id;
d.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;'
  + 'border:3px solid #ff7a00;border-radius:9px;background:rgba(255,122,0,.10);'
  + 'box-shadow:0 0 0 3px rgba(255,122,0,.25),0 0 18px 2px rgba(255,122,0,.45);'
  + `left:${r.left-p}px;top:${r.top-p}px;width:${r.width+2*p}px;height:${r.height+2*p}px`;
document.body.appendChild(d);
```

Target the `<a>` or `<button>`, **not** its `<td>`. A table cell is mostly empty space, so a
cell-sized box stretches across nothing and reads as sloppy. Use a `border-radius` around 22px
when boxing a pill-shaped console button so the box follows its shape.

Give every box a distinct `id` prefixed `__hl` and clear them with
`document.querySelectorAll('[id^="__hl"]').forEach(e => e.remove())` at the top of each pass —
stale boxes from a previous shot are positioned absolutely and will sit in the wrong place
after any reflow.

For "just visit this page" steps there is no control to point at. Box the page heading.

## Park the cursor

`computer: screenshot` captures the OS pointer. `hover` to a far corner before shooting, or
the arrow lands in the middle of your documentation.

## Crop anchored, not centred

```bash
ffmpeg -y -loglevel error -i "$SRC" -vf "crop=W:H:0:0" out.png   # top-left anchored
```

**`sips -c H W` crops from the centre** and will silently eat your header and breadcrumb.
Console pages are mostly empty below the content, so cropping matters — it is the difference
between a tight figure and a screenshot with 400px of background.

## Gotchas that cost real time

- **The AWS console will not render on a hash-only navigation.** `navigate` to
  `...#/queues/https%3A%2F%2F...` gives a blank page, because the SPA never re-routes. Follow
  every such navigate with `javascript: location.reload()` and a ~10s wait.
- **Never dispatch `input` on a React-controlled field.** Setting `.value` *and* firing the
  event made the SQS console re-run its filter, find no match for the fake name, and re-render
  — wiping every DOM edit. Set `inp.value = 'QUEUE-NAME'` with **no** event: the field looks
  filled, and nothing re-renders.
- **Do not hide a banner by walking up parents until one is "big enough".** That heuristic
  matched the page wrapper and blanked the entire screen. Target the component:
  `document.querySelectorAll('[class*="awsui_flashbar"]').forEach(e => e.style.display='none')`.
  Its own dismiss button may not stick across a re-render.
- **Screenshot dimensions drift between calls** (1432×840 then 1447×849 for the same window).
  Crop geometry derived from one shot may be a few pixels off on the next — re-measure per
  image rather than reusing a constant.

## Sanitization is one-way

These images cannot be refreshed by re-shooting: the surgery that produced them lives only in
the JS you ran. If the vendor restyles the console, whoever refreshes them starts over. Two
consequences worth telling the user about up front:

- keep the screenshot count to steps where the control is genuinely hard to find
- save the originals to a named folder (`~/Desktop/<project>-screenshots/01-….png`) with
  ordered, descriptive filenames

## Handing off

Producing the file is where this skill stops. To place it in a page:

- **Confluence** → the `confluence-editor` skill (`file_upload` to the editor's hidden file
  input inserts at the cursor).
- **GitHub PR/issue on a private repo** → the `upload-image-to-github` skill.
