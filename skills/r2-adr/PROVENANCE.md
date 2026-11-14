# upstream/ is VENDORED: do not edit it

`upstream/` is Vercel's `adr-skill`, copied unedited from `vercel/ai` at `skills/adr-skill/`, commit `7aae3c3a809765413613249c76b521eaa52ef3af` (2026-11-13, "docs: simplify ADR format and templates (#25036)"). Apache-2.0, Copyright 2023 Vercel, Inc. The only change is the rename `SKILL.md` → `UPSTREAM-SKILL.md`, so no skill loader registers it as a second skill.

Vercel marks it `internal: true`, so the `skills` CLI does not list it and `npx skills update` never refreshes it. It is here because no published ADR skill matched the format Joseph wanted (research: `.scratch/adr-practice/research.md`; decisions: `~/.agents/state/viz/grill-r2-adr/`).

## Why it stays unedited

The format is the part the industry improves; our rules are not. Our rules live in `../SKILL.md` and override upstream from outside, so an upgrade is a re-copy, never a merge.

## Upgrading

`upgrade-ai-setup` runs this on every run and proposes a re-copy when it prints anything:

```sh
gh api "repos/vercel/ai/commits?path=skills/adr-skill&since=2026-11-13T00:00:00Z" --jq '.[]|select(.sha!="7aae3c3a809765413613249c76b521eaa52ef3af")|[.sha[:7],.commit.author.date[:10],(.commit.message|split("\n")[0])]|@tsv'
```

To re-copy: replace `upstream/` with the new tree, rename `SKILL.md` again, update the commit, date and `since` above, then reread `../SKILL.md`'s overrides against the new upstream. The same run also searches for a better published ADR skill or standard; switching sources means replacing `upstream/` and this file.
