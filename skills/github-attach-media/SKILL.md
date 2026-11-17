---
name: github-attach-media
description: "Upload an image, screenshot, or video to get a renderable GitHub user-attachments URL for a PR, issue, comment, or Projects card, including private repos (no attachment API; raw.githubusercontent won't render). Use when a PR or issue body needs a hosted image."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    github: user-attachments upload through the wiki editor
    chrome: file-input upload through the browser skill (OpenCode Browse)
  requires:
    skills: [browser]
    commands: [gh, jq]
    manual: [Chrome]
---

# GitHub upload: images and video (→ user-attachments CDN URL)

GitHub has **no attachment API**. The only way to get a renderable, access-controlled image URL is GitHub's own uploader, which lives on the classic Markdown editors. This skill drives it with browse (the `browser` skill's default tool) and hands you a `https://github.com/user-attachments/assets/<uuid>` URL you can drop into any PR/issue/comment/Projects body via `gh`.

Why not the obvious alternatives:
- **`raw.githubusercontent.com` from a private repo** → does NOT render (camo can't authenticate). Dead end.
- **The React `/issues/new` editor** → has no `<file-attachment>` element to drive reliably. Use the classic wiki editor below.

## The mechanism

Open a repo's **wiki new-page** (`https://github.com/<owner>/<repo>/wiki/_new`), which holds a classic `<file-attachment>` with a real `<input type=file>`. `setInputFiles` on that input fires GitHub's real uploader, which inserts `<img src="…user-attachments/assets/…">` markup into `#gollum-editor-body`; the script harvests the URL from the body. Use the wiki purely as an uploader and **never save the page**; the asset persists on its own once uploaded.

**Access control / which repo's wiki to use.** A `user-attachments` asset is scoped to whoever can see the repo it was uploaded through. Prefer the **same repo** as the PR/issue so viewers can see it. If that repo's wiki is disabled or you can't edit it (its `/wiki/_new` redirects to the repo home), use another repo **your audience can also see** (e.g. another repo in the same org). The asset stays private to those viewers.

**browse's file root.** `setInputFiles` accepts only files under `files.dir`, browse's private folder (a path in a shared temp dir is refused with `ExecuteFileAccessError`). The script copies your file there and removes the copy afterwards.

## Steps

**1. Session.** A browse session signed in to GitHub as an account that can edit the target repo's wiki (`browse session new gh`; see the `browser` skill for `browse status` and logins).

**2. Upload.**

```sh
sh scripts/upload.sh gh <owner>/<repo> /path/to/image.png
```

It prints `{ url, imgTag }`, or `{ error }` (wiki disabled or no access, or a timeout, with the current body). Images, `.mov`, `.mp4` and `.webm` all work; a video takes longer, so the script polls up to 90 s. Add `--dry-run` to stop just before the file reaches GitHub's uploader: it proves the copy, the classic editor and the file input, and publishes nothing.

**3. Use the URL.** Set it wherever you need it; the body is plain Markdown/HTML:

```bash
gh pr edit <N>   --body "<img width=\"1200\" src=\"$URL\" />\n\n$(cat body.md)"
gh issue edit <N> --body "..."
gh project item-edit --id <DI_…> --body "![viz]($URL)\n\n<existing>"
```

Prefer building the full body in a file and passing `--body-file` to avoid escaping pain.

**4. Clean up.** The script empties the editor and leaves the wiki page unsaved (it accepts the "leave site?" dialog on the way out). `browse session delete gh` when you are done with the session.

Several files: run the script once per file; each run starts from an empty editor, so the one URL in it is that upload's.

## Verify
- **Bytes:** for proof GitHub serves that exact file, fetch its signed URL (no browser needed) and hash it against the local file:
  `U=$(gh api markdown -f mode=gfm -f context=<owner/repo> -f text='![x](<url>)' | grep -o 'https://private-user-images[^"]*' | head -1 | sed 's/&amp;/\&/g'); curl -s "$U" | shasum -a256`
- **Page:** open the PR/issue and look: the image renders (broken = wrong repo scope or a bad URL), a video shows a player. A background tab may not load video, and a fresh upload can take a minute to serve, so a spinner there is not a failed upload; the hash above settles it.

## Notes
- `<img width="1200" height="630" …>` gives a stable render size for a 1200×630 OG card; `![alt](url)` is fine otherwise.
- The asset is permanent and independent of the wiki page, so it is safe to leave the wiki unsaved.
- Status: the staging half (copy into `files.dir`, classic editor and `file-attachment input[type=file]` found, `setInputFiles` accepting the staged file, the unsaved-page exit) was run with `--dry-run` on 2026-11-13. The final `setInputFiles` on the real input and the URL harvest are **untested** here (they would publish an asset); if a run returns a timeout, read `body` in the result and check the input's `change` handling before blaming the repo.
- If browse is down, the `browser` skill lists its fallbacks; the same input/`setInputFiles` idea applies in agent-browser (`upload`).
