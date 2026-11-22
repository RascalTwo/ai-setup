---
name: hunk-review-viz
description: "A local page for reviewing commits one at a time, file by file and hunk by hunk, in the order the agent says reads best. The reviewer marks each hunk ✓ approve, ✎ change this or ? question, by a speakable ID (\"amber falcon\"), and the marks survive rewrites and force-pushes. Use when the user wants to review a branch, PR or commit range commit by commit, says \"hunk review\", \"review viz\" or \"let me review the commits\", or after pr-shape reshapes a branch they will read. Its story (a sentence per hunk) also prints as the walkthrough r2-pr puts in a PR body. Needs the viz skill."
rascaltwo-ai-setup:
  kind: skill
  state: true
  requires:
    skills: [viz]
    commands: [git, node]
---

# hunk-review-viz: commit-by-commit review that survives rewrites

The reviewer reads one commit at a time. Each commit shows its files and hunks in reading order, and every hunk and file carries a two-word **ID** ("amber falcon") they can say out loud. They mark what they read: **✓** approve, **✎** change this, **?** question, each with an optional note. You fix, rewrite, force-push and refresh; their marks follow the content:

- a hunk whose changed lines are the same keeps its mark, even in another commit;
- an approved hunk whose content changed comes back as **changed since you approved**;
- a flagged or questioned hunk whose content changed comes back as **addressed: re-review**, with their note and your reply, and shows by default only **what changed since they saw it** (their code then vs now, unchanged stretches folded; `v` or a button switches to the whole hunk);
- a mark carries only to a hunk in the same file that shares at least one changed line; one with nowhere to go is listed as **content gone**;
- a question you replied to without changing anything shows as **answered**.

A fingerprint of repo, path and changed lines (not line numbers or context) is what follows a hunk. The ID is made from that fingerprint, so it stays the same as long as the content does. Design record: the grill page `grill-commit-review` in the viz library.

`$HRV` is this skill's directory. The CLI is `node "$HRV/scripts/review.ts"`; its header lists every command.

## Steps

1. **Open the review.** One review per piece of work, named the way you'd talk about it (`sai-website#1885`). Point it at branches, not SHAs, so a rewrite stays in the same review:
   `node "$HRV/scripts/review.ts" open <name> --repo <path> --range <base>...<head> [--label <repo name>] [--repo … --range …]`
   Several `--repo` pairs make one review across repos. Re-running `open` re-points an existing review and keeps its marks. It prints the URL; open it for the reviewer (app-panel `show`, else `open <url>`).
   *Done when* the page shows every commit in the range and no repo line shows an error.

2. **Write the reading order and the story.** `review.ts ids <name>` lists every commit, file and hunk. Write `order.json` in the page folder (`review.ts dir <name>`):
   `{ "pr": { "repo": "<owner/name>", "number": <n> }, "lookHere": { … }, "commits": [ { "match": "<commit subject>", "repo": "<label>", "why": "<one line: why read this now>", "files": [ { "path": "…", "why": "…" } ] } ], "tour": [ { "hunks": ["<hunk ID>"], "say": "<one to three sentences>", "lines": [[<from>, <to>]] } ] }`
   Commits match by subject, which survives a rewrite (a SHA prefix also works). With several repos, interleave commits the way the change flows (the API change, then its caller). Unlisted commits follow in git order, and unlisted files follow by kind (code, tests, docs, binaries, lockfiles). Only approved hunks and fully approved files start folded. The shape is `OrderFile` in `template/contract.ts`.
   - **`tour`** is the story, one step per thing to understand, in the order you'd explain it. The page shows each step's sentence, numbered, above its first hunk, and the PR body's walkthrough is made from it (step 7). **Follow the data**: start where the change is triggered, then open what it calls, and name the next thing so the reader has something to land on. Plain written English: what the code does, then why it matters. Say reuse ("the same check as before"), and make code copied into several files one step. `lines` cuts a long hunk into several steps by new-file line ranges. Every production hunk belongs to a step, imports aside.
   - **`lookHere`**: the four lines a reviewer reads before the diff, each naming files or functions, never a summary. `start` (the one place to start reading), `skip` (what to skim or skip), `unsure` (what you doubt), `feedback` (the question for the reviewer). Leave out a line with nothing true to say. r2-pr copies them into the PR body word for word.
   - **`pr`**: the GitHub repo and, once it exists, the PR number, for the walkthrough's links.
   *Done when* every commit has a `why`, each commit's listed files are in the order you'd explain them, and step 7's command prints without refusing.

3. **Wait for the pass.** Send on the page writes `{"type":"send"…}` to `<page dir>/.viz-data/feedback.jsonl`. Wait in the background: `until grep -q '"type":"send"' <dir>/.viz-data/feedback.jsonl; do sleep 2; done`. A reply in the terminal ("amber falcon: rename it") counts as the same pass.
   *Done when* Send landed or the reviewer spoke.

4. **Read the marks.** `review.ts status <name>` lists every flag, question, addressed and changed item by ID, with notes and replies (`--json` for structure, `--all` for every hunk). `node ~/.claude/skills/viz/viz.ts feedback <viz id>` adds what they said or typed with 🎙 or 💬, anchored to the hunk or file ID it was said over. An ID they speak in the terminal resolves with the same `normalizeId` (case and dashes don't matter).
   *Done when* you can name, for every ✎ and ?, what they want.

5. **Answer and fix.** For a question, answer on the hunk: `review.ts reply <name> "<id>" <text>`. For a flag, make the change, then reply with one line saying what you did. The reply shows inside the diff, under the lines you changed since their mark (those lines get a blue gutter marker); `--line <n>` pins it under a line of the new file instead, for a reply about one line. Reply to an ID even after the change removed its hunk: the old mark still knows it. Rewrite, reshape or force-push as the work needs; marks follow content, not commits.
   *Done when* every ✎ is changed or replied to and every ? is replied to.

6. **Refresh and hand back.** `review.ts refresh <name>` re-reads git. The open page reloads where the reviewer was (it can also press ↻ Refresh after they push themselves). Update `order.json` if commits were renamed. Tell the reviewer what changed in one line per ID, then go back to step 3.
   *Done when* `status` shows no ✎ or ? without a reply, and the reviewer has the page again.

7. **Print the walkthrough** for a PR body (r2-pr calls this): `node "$HRV/scripts/walkthrough.ts" <name>` prints the tour as markdown, each step's sentence and then its code as text GitHub colours (added-only hunks in the file's language, changed ones as `diff`), linked to those lines on GitHub. Import-only hunks are left out and listed at the end. It refuses, naming the hunk IDs, while a production hunk is missing from the tour. `node "$HRV/scripts/classify.ts" <repo> <base>...<head>` prints the change's size line.
   *Done when* it prints without refusing.

## State and files

- `~/.agents/state/hunk-review-viz/reviews.json`: review name → page folder and URL.
- The page folder (a viz page, `hunk-review-<name>`): `review.json` (repos and ranges; written by `open`), `order.json` (yours), `.viz-data/state.json` (marks and replies; written by the page and `reply`), `.viz-data/feedback.jsonl` (Send and spoken comments).
- A page keeps the template files it was made with. To give an older review a newer page, copy `template/*.ts` and `review.css` over its folder.
- A mark with nowhere to go shows in `status` and on the page as content gone. Raise it with the reviewer rather than dropping it.
