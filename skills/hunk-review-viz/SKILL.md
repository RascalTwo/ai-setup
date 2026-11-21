---
name: hunk-review-viz
description: "A local page for reviewing commits one at a time, file by file and hunk by hunk, in the order the agent says reads best. The reviewer marks each hunk ✓ approve, ✎ change this or ? question, by a speakable ID (\"amber falcon\"), and the marks survive rewrites and force-pushes. Use when the user wants to review a branch, PR or commit range commit by commit, says \"hunk review\", \"review viz\" or \"let me review the commits\", or after pr-shape reshapes a branch they will read. Needs the viz skill."
rascaltwo-ai-setup:
  kind: skill
  state: true
  requires:
    skills: [viz, pr-viz]
    commands: [git, bun]
---

# hunk-review-viz: commit-by-commit review that survives rewrites

The reviewer reads one commit at a time. Each commit shows its files and hunks in reading order, and every hunk and file carries a two-word **ID** ("amber falcon") they can say out loud. They mark what they read: **✓** approve, **✎** change this, **?** question, each with an optional note. You fix, rewrite, force-push and refresh; their marks follow the content:

- a hunk whose changed lines are the same keeps its mark, even in another commit;
- an approved hunk whose content changed comes back as **changed since you approved**;
- a flagged or questioned hunk whose content changed comes back as **addressed: re-review**, with their note and your reply, and shows by default only **what changed since they saw it** (their code then vs now, unchanged stretches folded; `v` or a button switches to the whole hunk);
- a mark carries only to a hunk in the same file that shares at least one changed line; one with nowhere to go is listed as **content gone**;
- a question you replied to without changing anything shows as **answered**.

A fingerprint of repo, path and changed lines (not line numbers or context) is what follows a hunk. The ID is made from that fingerprint, so it stays the same as long as the content does. Design record: the grill page `grill-commit-review` in the viz library.

`$HRV` is this skill's directory. The CLI is `bun "$HRV/scripts/review.ts"`; its header lists every command.

## Steps

1. **Open the review.** One review per piece of work, named the way you'd talk about it (`sai-website#1885`). Point it at branches, not SHAs, so a rewrite stays in the same review:
   `bun "$HRV/scripts/review.ts" open <name> --repo <path> --range <base>...<head> [--label <repo name>] [--repo … --range …]`
   Several `--repo` pairs make one review across repos. Re-running `open` re-points an existing review and keeps its marks. It prints the URL; open it for the reviewer (app-panel `show`, else `open <url>`).
   *Done when* the page shows every commit in the range and no repo line shows an error.

2. **Write the reading order.** `review.ts ids <name>` lists every commit, file and hunk. Write `order.json` in the page folder (`review.ts dir <name>`):
   `{ "commits": [ { "match": "<commit subject>", "repo": "<label>", "why": "<one line: why read this now>", "files": [ { "path": "…", "why": "…" } ] } ] }`
   Commits match by subject, which survives a rewrite (a SHA prefix also works). With several repos, interleave commits the way the change flows (the API change, then its caller). Unlisted commits follow in git order, and unlisted files follow by kind (code, tests, docs, binaries, lockfiles). Only approved hunks and fully approved files start folded.
   *Done when* every commit has a `why` and each commit's listed files are in the order you'd explain them.

3. **Wait for the pass.** Send on the page writes `{"type":"send"…}` to `<page dir>/.viz-data/feedback.jsonl`. Wait in the background: `until grep -q '"type":"send"' <dir>/.viz-data/feedback.jsonl; do sleep 2; done`. A reply in the terminal ("amber falcon: rename it") counts as the same pass.
   *Done when* Send landed or the reviewer spoke.

4. **Read the marks.** `review.ts status <name>` lists every flag, question, addressed and changed item by ID, with notes and replies (`--json` for structure, `--all` for every hunk). `bun ~/.claude/skills/viz/viz.ts feedback <viz id>` adds what they said or typed with 🎙 or 💬, anchored to the hunk or file ID it was said over. An ID they speak in the terminal resolves with the same `normalizeId` (case and dashes don't matter).
   *Done when* you can name, for every ✎ and ?, what they want.

5. **Answer and fix.** For a question, answer on the hunk: `review.ts reply <name> "<id>" <text>`. For a flag, make the change, then reply with one line saying what you did. The reply shows inside the diff, under the lines you changed since their mark (those lines get a blue gutter marker); `--line <n>` pins it under a line of the new file instead, for a reply about one line. Reply to an ID even after the change removed its hunk: the old mark still knows it. Rewrite, reshape or force-push as the work needs; marks follow content, not commits.
   *Done when* every ✎ is changed or replied to and every ? is replied to.

6. **Refresh and hand back.** `review.ts refresh <name>` re-reads git. The open page reloads where the reviewer was (it can also press ↻ Refresh after they push themselves). Update `order.json` if commits were renamed. Tell the reviewer what changed in one line per ID, then go back to step 3.
   *Done when* `status` shows no ✎ or ? without a reply, and the reviewer has the page again.

## State and files

- `~/.agents/state/hunk-review-viz/reviews.json`: review name → page folder and URL.
- The page folder (a viz page, `hunk-review-<name>`): `review.json` (repos and ranges; written by `open`), `order.json` (yours), `.viz-data/state.json` (marks and replies; written by the page and `reply`), `.viz-data/feedback.jsonl` (Send and spoken comments).
- A mark with nowhere to go shows in `status` and on the page as content gone. Raise it with the reviewer rather than dropping it.
