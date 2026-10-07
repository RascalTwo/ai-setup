# The body

A draft is one markdown file. Everything in it is GitHub-flavored markdown except the two media
lines (`r2-pr:video <path>`, `r2-pr:image <path>`), which `body.ts finalize` turns into the
uploaded video and image.

## Contents
- Skeleton
- Repo template first
- The written sections
- Title
- Why it is shaped this way (GitHub facts, each checked)

## Skeleton

Two levels: a **bite-size** part a reviewer reads in a minute or two before deciding how to
review, then an **In depth** divider, then everything else. The film opens the in-depth part.

````markdown
[Why](#user-content-why) · [Where to look](#user-content-where-to-look) · [In depth](#user-content-in-depth) · [How](#user-content-how) · [Evidence](#user-content-evidence) · [Rollout](#user-content-rollout) · [Not in this PR](#user-content-not-in-this-pr)

Closes #1097.

<a id="why"></a>
## Why
…two or three sentences…

<!-- r2-pr:look -->
<a id="where-to-look"></a>
## Where to look
- **Start here**: …
- **Skim or skip**: …
- **Not sure about**: …
- **Feedback wanted**: …

Size: 22 files, 515 lines to read (132 code, 383 tests)
<!-- /r2-pr:look -->

**Proven**: before → after, in one line. AC1 Confluence links keep their address: `test_link_urls_are_kept_inline_as_full_urls`. …

<a id="in-depth"></a>

---
<p align="center"><b>In depth</b></p>

<!-- r2-pr:walkthrough -->
r2-pr:video ~/Desktop/pr-1187.mp4

> [!NOTE]
> Has sound.

<div align="center"><details><summary>Image walkthrough</summary>

r2-pr:image ~/Desktop/pr-1187.poster.png

</details></div>

<div align="center"><details><summary>Changes walkthrough</summary>
<div align="left">

…output of pr-viz's review-order.ts…

</div>
</details></div>
<!-- /r2-pr:walkthrough -->

<a id="how"></a>
## How
…
````

Order, top down. **Bite-size**: the section links, the links line, Why, Where to look (with the
size line), the Proven line. **In depth**: the divider, the walkthrough (video, note, image,
changes), How, Evidence, Rollout, Not in this PR. Every heading a section link points at gets
`<a id="<slug>"></a>` on the line above it, and the link targets `#user-content-<slug>`. With no
film, the walkthrough section is the changes walkthrough alone, or nothing.

**Where to look** is r2-pr's, refreshed on every push. Its four lines are pr-viz's `plan.json`
`lookHere`, word for word; with no film, write them yourself by the same rule (pr-viz
`reference/plan.md` → Where to look). A line with nothing true to say is left out. The size line
is `bun "$PRVIZ/scripts/classify.ts" <checkout> <base>...<head>` verbatim: a computed fact, with
no verdict on it. Generated files it can't spot by path go in `--classify '{"<path>": "lock"}'`
(pr-viz's `plan.json` `classify` is the same map).

## Repo template first

When the repo has a PR template (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/`,
`docs/pull_request_template.md`), its headings and checklist are the written sections, **in its
order**, filled with the content below: *Goal* ← Why, *Solution* ← How, *Screenshots* ← Evidence,
*Links* ← the links line. r2-pr's layout fills in around it:

- **Bite-size**: everything above the template's Why-role heading (*Goal*), that heading's
  section, then Where to look and the Proven line. A template with no Why-role heading gets Where
  to look and Proven straight after the section links.
- **In depth**: the divider and the walkthrough, then the rest of the template in its order, then
  r2-pr's sections it lacks (Evidence, Rollout, Not in this PR).

PR #1187's template (Goal · Solution · Links · Checklist · Screenshots) comes out as: section
links → Goal → Where to look → Proven → *In depth* → walkthrough → Solution → Links → Checklist →
Evidence → Rollout → Not in this PR (Screenshots deleted: no UI change).

Tick a checklist box only when it is true. A conditional box that
doesn't apply ("if changes impact project setup") is struck through with the reason, after you
checked: `- [ ] ~~I updated related docs (if changes impact project setup)~~ No docs describe
this change.` For the docs box, search the repo's markdown for what the PR changes first.
Anything the repo's `CONTRIBUTING.md` asks a PR to carry comes from there, never from this file.
The section links list whatever headings the body ends up with.

## The written sections

The fewest words that carry the message; then `unslop` (read `~/.claude/skills/unslop/SKILL.md`
and apply it to every sentence). A section with nothing true to say is deleted, heading and all.
Name no commit anywhere a reader sees it: a commit ID goes stale on the next push or rebase and
forces a refresh for nothing. Say "this branch" or "`main`"; a Re-run block that needs the base
computes it (`git merge-base origin/main HEAD`).

- **Why**: the problem, from the reader's side. Who hits it, what it costs. Two or three
  sentences: it sits in the bite-size part.
- **How**: opens with one summary visual, the smallest that makes the point, picked per PR from
  this menu (Matt Pocock's `pr` skill, `mattpocock/skills` → `skills/in-progress/pr`):
  pseudocode · a call tree · a component tree · a file tree · a `mermaid` diagram · a `diff`
  of any of those · a before → after of the output. Then the mechanism, briefly. A second
  visual earns its place only when the mechanism branches (several inputs, paths or cases);
  then it is a `mermaid` diagram, after the prose that it replaces. Draw every `mermaid`
  diagram by `~/.agents/skills/design-doc-mermaid/SKILL.md` (read it; the skill is hidden from the model), with `#nbsp;#nbsp;` between an emoji and its label.
- **Proven** (bite-size, one paragraph, no heading): before → after in one line, then each
  acceptance criterion in one line with what proves it; with a film, these are pr-viz's
  `plan.json` criteria, word for word. A criterion not proven yet says so in its line.
- **Evidence** (in depth): each Proven item that needs more than a test's name, with its
  re-run. Last, what is not proven yet and when it will be ("checked after deploy"). **Every item is re-runnable**:
  someone with repo access can repeat it and see the same result, or prove it false. A test's
  name is enough, with one line saying how to run the tests. Anything else (a real file, a real
  run, an eval) carries its exact input (repo path, URL or S3 key), the command, and the output
  it printed, in a collapsed `<details><summary>Re-run</summary>` under the item. Run that
  command yourself before it goes in. An item nobody can re-run is cut, or kept with one plain
  sentence saying why it can't be re-run and what will check it later.
  A behavior that needs a throwaway test to prove it is a **missing test**, caught at SKILL.md's
  step 3 ("Is it ready?"): push back, and cite the test by name once it exists.
- **Rollout**: one sentence of risk (can it be walked back? what does it reach?), then the steps
  after merge, numbered. Subsection **Rollback**: how to undo it.
- **Not in this PR**: what a reviewer might expect here and won't find.

## Title

The repo's convention if it has one. Otherwise plain English, the why over the what
("Keep link URLs so the internal docs assistant can cite them" over "Add inline_link_urls").

## Why it is shaped this way (GitHub facts, each checked)

- A bare `https://github.com/user-attachments/assets/<id>` line renders a video player. GitHub
  strips a `poster` attribute, but shows the video's first frame; pr-viz paints the hero there.
- `[!NOTE]` renders GitHub's blue note box.
- `<div align="center">` centres a `<details>` summary (`align` on `<summary>` is ignored), and
  everything inside it; `<div align="left">` puts the walkthrough's content back.
- Headings in a PR body get no anchors (unlike a README), so `#why` goes nowhere. An explicit
  `<a id="why">` survives, renamed `user-content-why`; link to that.
- A link cannot open a collapsed `<details>`, so the section links skip the walkthrough (it sits
  right below them anyway).
- A code fence has one language: syntax colours or diff colours, never both. Hence the changes
  walkthrough's split: added-only hunks in their language, changed hunks as `diff`.
- A permalink to lines renders an inline snippet capped at ~240 px of height; the walkthrough
  uses code blocks, which show every line.
- Compare-view links (`/compare/<base>...<head>#diff-…R<a>-R<b>`) highlight lines like Files
  changed does, and need no PR number, so a draft's links work before the PR exists.
