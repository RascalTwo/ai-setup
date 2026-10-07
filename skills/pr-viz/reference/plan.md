# plan.json

The single source for both modes. Plain JSON: the page reads it directly, and `build.ts`
derives `narration.json` and `hunks.json` from it — edit this, never those. What the page
reads of it is typed in `template/pr-viz.ts` (`Plan`, and `PlanScene` for each scene kind).

```jsonc
{
  "pr": { "repo": "owner/name", "number": 1187, "url": "…", "title": "…", "base": "bd68977", "head": "4165dad" },
  "source": { "repo": "/path/to/checkout", "range": "bd68977...4165dad" },   // or { "diff": "pr.diff" }
  "classify": { "resources/": "binary" },          // optional: path substring → prod|test|lock|binary|docs
  "voice": "af_heart", "speed": 1.12,               // Kokoro

  "hero": "The change",                            // the scene title whose last frame is the PR's top image

  "lookHere": {                                    // Where to look: the four lines a reviewer reads before the diff
    "start": "`file_producer.py`: the new link pass every module calls",   // the one place to start reading
    "skip": "`uv.lock` and the five `pyproject.toml` bumps: dependency pins",  // what to skim
    "unsure": "Whether relative links should resolve against the page URL",    // what the author doubts
    "feedback": "Is dropping malformed links silently right, or should it log?" // the question for the reviewer
  },

  "concepts": { "chunk": "A slice of a document's text…" },   // glossary: {{c:chunk|chunks}} in any text

  "criteria": [                                     // acceptance criteria — what the change promises; the trace
    { "id": "AC1", "title": "Confluence links keep their address",
      "status": "tested",                           // tested | partial | untested
      "proof": ["confluence · test_link_urls_are_kept_inline_as_full_urls", "real page run"],
      "gap": "only for partial/untested: what isn't proven — say it plainly (\"no test pins X\")" }
  ],

  "scenes": [                                       // in order; each is a chapter of the film
    { "section": "why",                             // why | what | look | how | proof | risk | check (chapter + review grouping)
      "title": "The problem",                       // chapter name (bar tooltip, review heading)
      "heading": "On-screen heading",               // default: title; false for none
      "subheading": "optional",
      "kind": "statement",                          // see scenes.md
      "zoom": 1.2,                                  // optional: overrides the automatic fit
      "poster": false,                              // optional: leave off the poster (only makes sense moving)
      "short": true,                                // optional: in the short cut (see below)
      "say": ["One beat per line. The picture waits for each line to finish."],
      "…kind fields…": "…" }
  ]
}
```

## Beats and timing

Every `say` line is one beat; beats are numbered through the whole film. A beat lasts as long
as its spoken clip plus a breath, so timing is never typed — rewrite the line, or split it.
Items in a scene appear one per line in order (item *i* on line *i*, extras queue on the last
line); pin one with `"at": <line index>`.

## Where to look

`lookHere` is one line each, naming files or functions, never a summary of the change. r2-pr
copies the four lines into the PR body, so they read on their own. The `look` scene kind
(scenes.md) draws them: all four in the Where to look chapter, `"rows": ["unsure", "feedback"]`
in Check these. A line with nothing true to say is left out.

## Text

Every text field takes `**strong**`, `` `code` ``, `{{c:id|words}}` (glossary hover) and `\n`
(line break). HTML is escaped — write the characters you mean.

## Source

`build.ts` runs `git diff -U3 <range>` in `source.repo`, or reads `source.diff` (e.g. saved
from `gh pr diff`). Files are classed `prod` / `test` / `lock` / `binary` / `docs` by path;
fix a misclass with `classify`. Every `prod` hunk must appear in a `tour` scene.

## The short cut

`#{"cut":"short"}` plays a ~1-minute film for a **stranger** who won't watch the full one. It
reuses the full film's scenes and clips; nothing new is written or spoken.

**The test.** From the short cut alone, the stranger can answer all three:

1. **Why** does this change exist?
2. **What** does it change — all of it, at headline level?
3. **Where** do I look, and what is wanted from me?

**Picking.** One scene per question: the scene that answers it on its own. With no scene marked,
the cut is the first Why, What and Where to look scenes, the `hero`, and Check these — often right. Mark
`"short": true` on the scenes you want instead when that guess misses, typically:

- the PR makes several changes and the first What scene covers one of them ("Change 1: gzip");
- the first Why scene is setup ("what the page downloads") rather than the problem;
- the hero already says the What, so a second What scene only repeats it.

A question no single scene answers — no scene names both changes — is a gap in the full film:
add the summary scene there, and both cuts get it.
