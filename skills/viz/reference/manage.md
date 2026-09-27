# Finding and changing vizzes

Every verb here names a viz by its **folder path**, not a slug — a slug isn't unique across
containers, a path is, and you get tab-completion for free (ADR 0008). Flags for each:
`viz <verb> --help`.

The mutating verbs are author-side only (they never build or deploy), fail closed, refuse a
mirrored-in dir (edit the origin), and **auto-commit** with surgical staging. Use them
rather than hand-editing metas or moving folders: they carry the fixups (mirror and vendor
declarations, `<title>` sync, link guards) a hand edit misses.

## Finding what exists — read-only

These never commit, never mutate, and write no index — the listing is derived from disk
on every call.

- **`viz ls`** — every viz, newest first: date, posture/listing, approval and card state,
  path, title. Filter it down to a worklist, e.g. everything not yet approved.
- **`viz search <term>`** — matches path, title, description, tags **and page source**, so it
  finds a viz by the *technique* it used. The printed path is what you pass to `--from`.
- **Hidden tags.** A viz carrying a tag listed in `viz.config.json`'s `hiddenTags` (default
  `["grill-session"]`) is left out of `viz ls`, `viz search`, the self-portrait and the
  lobby. `viz ls --all` / `viz search <term> --all`, or the self-portrait's **show all**,
  bring it back; the lobby has no switch — untag the viz. The skill's `viz.config.json`
  is the default; one at the central library root replaces it whole (ADR 0020).
- **`viz history <viz>`** — per-viz git log, central or repo-local alike.
- **`viz ranking`** — the pairwise quality ranking so far, answered by the human in the
  self-portrait's Rank tab. Read it when choosing which viz to fork or feature.
- **`viz urls <container>`** — where a container deploys (from its `base-url.sh`) and its
  card-public share links. Use it to give the user a real link after a deploy, instead of
  guessing the host.

## Forking one — `viz create <slug> --from <viz-folder>`

Copies the whole viz dir, then re-stamps the copy's identity:

- **Posture → `local`, listing → `unlisted`, always.** Posture is a trust decision and never
  crosses a boundary by inheritance (ADR 0006); a copy is that kind of boundary.
- **A new `viz:uid`** — two vizzes claiming one identity corrupt everything keyed on it
  (ADR 0014). `viz:title` becomes the new slug; `viz:description` is cleared.
- **Not copied:** `comments.json` (anchored to the original's elements), `og.auto.png`
  (regenerate it), `recordings.json` (the source's API tape — may hold secrets).
  `hero.html` *is* copied, so the fork keeps a card to edit down.
- **Refuses** a mirrored-in dir (`.mirror.json` present) — fork the origin.

## Changing one

- **`viz move`** — relocate or rename (a rename is a same-parent move); migrates mirror and
  vendor declarations.
- **`viz delete`** — removes the folder and its declarations.
- **`viz update`** — sets the axes below and the frame metadata (title, description, tags,
  linked-from, card-public), keeping `<title>` in sync with `viz:title`.
- **`viz rollback <viz> <commit>`** — restores an earlier commit and commits the restore.

The self-portrait's management drawer runs these same verbs, for a user who'd rather click.

## The axes

Three, independent — setting one never stamps another:

| axis | values | what it controls |
|---|---|---|
| `posture` | `public` · `private` · `local` | access; an undeclared posture makes a build refuse (ADR 0005) |
| `listed` | `listed` · `unlisted` | whether the viz gets a card on the lobby |
| `approved` | `true` · `false` | "a human judged THIS VERSION fit to publish". Stores a **content hash**, so any edit revokes it (ADR 0015). A publish gate: an unapproved or changed viz refuses to deploy; `local` vizzes are exempt. |

**Approval is the human's call, never yours.** Run `viz update <viz> --approved true` only
when the user has looked at this version and said so. Why the gate exists, and where it bites:
`reference/publishing.md`.

**Card-public** is for host-gated sites (SSO) whose links can't unfurl: it records a human
review of the viz's *card* (slug, title, description, hero) as safe for the open internet.
Like approval it stores a fingerprint, so any change to the card makes it **stale** until
re-reviewed; `true` refuses without a designed hero. What it produces at build time:
`reference/publishing-advanced.md`.

## One viz in two places — mirror or vendor

Both declare their edges at the **origin**, in its `mirrors.json`. Pick **mirror** to
publish the same viz onto another site under its own framing; pick **vendor** to hand a repo
a copy it owns and can run (ADR 0006, ADR 0010).

| | mirror (`viz mirror …`) | vendor (`viz vendor …`) |
|---|---|---|
| what lands in the sink | a **built, single-file artifact** (sealed if `private`) | a **verbatim source copy**, byte-identical to the origin |
| can the sink run/edit it | no — terminal; the verbs refuse it | yes — runs standalone with no skill installed |
| refreshed by | every `viz publish` of the origin | `viz publish` of the origin with `--push-vendors` (opt-in) |
| `access` means | posture **re-decided** for that sink | posture **acknowledged**; must match the origin's |
| framing in the sink | its own — `mirror update` overrides listing, title, description, tags | the origin's, verbatim |

- **`access` is required** on both `mirror add` and `vendor add`. It's the one field that
  never inherits, because access across a copy is a trust boundary. For a vendor it must
  equal the origin's posture — requiring it means a posture that changed since you last
  looked fails loudly instead of shipping quietly.
- **`vendor rm` does not delete the copy.** The next `--push-vendors` prunes it,
  origin-scoped, so removal goes through the path that created it.
- **`vendor sync`** pulls one copy from the sink side — the fail-soft path when the origin
  isn't reachable. **`vendor check`** byte-compares each copy against its **live origin**;
  **`vendor guard`** installs that check as a drift-blocking pre-commit hook.
- How `--push-vendors` writes and prunes: `reference/publishing-advanced.md`.

## Things that will bite you

- **A move changes the viz's id, so the old URL 404s.** No redirect, by design — these are
  scratch vizzes, not permalinks (ADR 0008). Re-share after the move.
- **Except a linked viz, which refuses.** Any `linked-from` entry makes `move`, `delete`,
  `rotate` and a posture change exit non-zero, listing the entries. Fix the inbound links
  (search Confluence/Slack for the URL), then re-run with `--break-links`. Not caught: a
  folder moved by hand, or a change of deploy host (ADR 0016).
- **Mirrored-in directories are terminal.** You can't mirror a mirror, and the verbs refuse
  to edit one — go to the origin.
- **`mirrors.json` is machine-local** (auto-gitignored — it maps sibling-repo paths), so
  declarations don't survive a fresh clone. A vendored copy's `.vendored.json` receipt is
  committed and does.
- **A move migrates vendor declarations**, but the sink's old directory is only renamed on
  the next `--push-vendors`.
