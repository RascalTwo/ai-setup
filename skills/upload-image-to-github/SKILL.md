---
name: upload-image-to-github
description: >
  Upload a local image to GitHub and get back a renderable user-attachments CDN URL to embed
  in a PR description, issue, comment, or Projects card — works for PRIVATE repos. Use whenever
  the user wants to "attach/embed an image or screenshot in a PR/issue", "put this image at the
  top of the PR", "add a picture to the GitHub description", "get a GitHub user-attachments URL",
  or when a PR/issue body needs a hosted image and there is no public URL for it. Solves the fact
  that GitHub has NO attachment API and raw.githubusercontent links from private repos do not
  render (camo can't auth).
---

# GitHub image upload (→ user-attachments CDN URL)

GitHub has **no attachment API**. The only way to get a renderable, access-controlled image URL
is GitHub's own uploader — which is a browser drag-drop onto a classic editor. This skill automates
that with Chrome MCP and hands you a `https://github.com/user-attachments/assets/<uuid>` URL you can
drop into any PR/issue/comment/Projects body via `gh`.

Why not the obvious alternatives:
- **`raw.githubusercontent.com` from a private repo** → does NOT render (camo can't authenticate). Dead end.
- **`file_upload` MCP tool** → currently rejects host paths (regressed). Don't rely on it.
- **Synthetic `cmd+v` paste of a clipboard image** → unreliable; the key event doesn't deliver image
  bytes to GitHub's paste handler. Use the **drop** path below instead.

## The mechanism

Put the image on the clipboard as base64 **text**, then dispatch a real `drop` event carrying a
reconstructed `File` onto a classic editor's `<file-attachment>` element. GitHub's real uploader runs
and inserts the `<img src="…user-attachments/assets/…">` markup, which we harvest. The bytes ride the
OS clipboard as text, never through the agent's context.

**Key constraint — you need a CLASSIC editor.** The `<file-attachment>` element only exists on GitHub's
classic Markdown editors, NOT the React `/issues/new` editor. The reliable one is any repo's **wiki new-page**:
`https://github.com/<owner>/<repo>/wiki/_new`. Use it purely as an uploader — **never save the page**;
the asset persists on its own once uploaded.

**Access control / which repo's wiki to use.** A `user-attachments` asset is scoped to whoever can see
the repo it was uploaded through. Prefer the **same repo** as the PR/issue so viewers can see it. If that
repo's wiki is disabled (its `/wiki/_new` redirects to the repo home), use another repo **your audience can
also see** (e.g. another repo in the same org). The asset stays private to those viewers.

## Steps

**1. Put the image on the clipboard as base64 text** (macOS):
```bash
base64 -i /path/to/image.png | tr -d '\n' | pbcopy
```
Note the `-i` — macOS `base64` needs it. (Linux: `base64 -w0 /path/to/image.png | xclip -selection clipboard`.)

**2. Open a classic wiki editor in Chrome** (load Chrome MCP tools first if deferred). Navigate to
`https://github.com/<owner>/<repo>/wiki/_new`, then verify it's really the classic editor:
```js
({ hasFileAttachment: !!document.querySelector('file-attachment'),
   hasBody: !!document.querySelector('#gollum-editor-body') })
```
Both must be `true`. If false, the wiki is disabled on that repo — try a different repo's wiki (see access-control note).

**3. Click into the editor body** (the "Page content" textbox) with the `computer` tool — this gives the
tab OS focus, required for `navigator.clipboard.readText()`.

**4. Drop + harvest.** Read `scripts/drop-and-harvest.js` and pass its contents to `javascript_tool`.
It rebuilds the File from the clipboard, dispatches the drop, polls for the URL, and returns
`{ url, imgTag }`. Grab `url`. Pass it **as-is** — it's top-level-await form on purpose; do NOT
re-wrap it in an `async () => {…}` IIFE (the tool returns the last expression but won't await a
Promise you hand back, so a wrapper serializes to `{}`). If you ever do get `{}`, the drop still
ran — just read the body to recover the URL:
`const v=document.querySelector('#gollum-editor-body').value; v.match(/user-attachments\/assets\/[0-9a-f-]+/)?.[0]`

**5. Use the URL.** Set it wherever you need it — the body is plain Markdown/HTML:
```bash
gh pr edit <N>   --body "<img width=\"1200\" src=\"$URL\" />\n\n$(cat body.md)"
gh issue edit <N> --body "..."
gh project item-edit --id <DI_…> --body "![viz]($URL)\n\n<existing>"
```
Prefer building the full body in a file and passing `--body-file` to avoid escaping pain.

**6. Discard the wiki editor — do NOT save.** Clear the body and drop the unsaved-changes guard, then
navigate away:
```js
const b = document.querySelector('#gollum-editor-body');
b.value = ''; b.dispatchEvent(new Event('input', {bubbles:true}));
window.onbeforeunload = null; true;
```
(If you navigate before clearing, Chrome throws a "Leave site?" dialog — clear first.)

## Verify
Navigate to the PR/issue and screenshot it — confirm the image actually renders (a broken image means
the wrong repo scope or a bad URL). This is the whole point; always eyeball it.

## Notes
- `<img width="1200" height="630" …>` gives a stable render size for a 1200×630 OG card; `![alt](url)` is fine otherwise.
- The asset is permanent and independent of the wiki page — safe to leave the wiki unsaved.
- One image per run is simplest; loop steps 1+4 for multiple (each drop appends a fresh URL to the body).
