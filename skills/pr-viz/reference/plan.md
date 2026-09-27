# plan.json

The single source for both modes. Plain JSON: the page reads it directly, and `build.ts`
derives `narration.json` and `hunks.json` from it — edit this, never those.

```jsonc
{
  "pr": { "repo": "owner/name", "number": 1187, "url": "…", "title": "…", "base": "bd68977", "head": "4165dad" },
  "source": { "repo": "/path/to/checkout", "range": "bd68977...4165dad" },   // or { "diff": "pr.diff" }
  "classify": { "resources/": "binary" },          // optional: path substring → prod|test|lock|binary|docs
  "voice": "af_heart", "speed": 1.12,               // Kokoro

  "concepts": { "chunk": "A slice of a document's text…" },   // glossary: {{c:chunk|chunks}} in any text

  "criteria": [                                     // acceptance criteria — what the change promises; the trace
    { "id": "AC1", "title": "Confluence links keep their address",
      "status": "tested",                           // tested | partial | untested
      "proof": ["confluence · test_link_urls_are_kept_inline_as_full_urls", "real page run"],
      "gap": "only for partial/untested: what isn't proven — say it plainly (\"no test pins X\")" }
  ],

  "scenes": [                                       // in order; each is a chapter of the film
    { "section": "why",                             // why | what | how | proof | risk | verdict (review grouping)
      "title": "The problem",                       // chapter name (bar tooltip, review heading)
      "heading": "On-screen heading",               // default: title; false for none
      "subheading": "optional",
      "kind": "statement",                          // see scenes.md
      "zoom": 1.2,                                  // optional: overrides the automatic fit
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

## Text

Every text field takes `**strong**`, `` `code` ``, `{{c:id|words}}` (glossary hover) and `\n`
(line break). HTML is escaped — write the characters you mean.

## Source

`build.ts` runs `git diff -U3 <range>` in `source.repo`, or reads `source.diff` (e.g. saved
from `gh pr diff`). Files are classed `prod` / `test` / `lock` / `binary` / `docs` by path;
fix a misclass with `classify`. Every `prod` hunk must appear in a `tour` scene.
