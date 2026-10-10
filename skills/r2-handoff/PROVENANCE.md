# r2-handoff is DERIVED from mattpocock/skills `handoff`

Unlike `documandments` (vendored, not ours to edit), this skill IS ours to edit. It forked so it can take upstream's changes by patch, so the first block of `SKILL.md` stays word for word upstream.

## Base

- Upstream: <https://github.com/mattpocock/skills>, `skills/productivity/handoff/SKILL.md`
- Base blob: `2eb98a51b97bb5bac461a26ad14828eeac827909` (upstream HEAD `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, 2026-09-29; last changed upstream by `d28dfdc39bea`, 2026-08-15, "Standardize cross-skill invocation on explicit 'call the Skill tool' phrasing")
- The installed copy at `~/.agents/skills/handoff` was byte-identical to that blob when this fork was made and upstream was removed (2026-10-01).

## What is upstream, what is ours

- **Upstream, kept verbatim and in order:** the five instruction paragraphs under "Handoff: this session writes its own" (5 of 5; 20% of `SKILL.md` by size, 7% of the whole skill).
- **Ours:** `template.md` (the section list), split mode, rescue mode, `scripts/`, the manifest.

## Why the additions exist

On a 173k-token session, a blind exam of conversation-only facts scored the successor's recall at 17% with no handoff, 41% with upstream's `/handoff`, 62% with `/handoff` given the section list in `template.md`, and 74% with rescue mode (digest script plus subagent, no resume). One session, one run, LLM answerers and grader, so treat the 12-point gap between the last two as thin. On a session whose state was fully recorded in git, plans and files, the exam could not tell the arms apart. The section list is the main ingredient; reconstruction adds a little.

## Taking upstream's changes

Upstream `handoff` is NOT installed (removed 2026-10-01). The tracker is the `stole` entry `mattpocock/skills/handoff` in `external-skills-reviewed.json`, whose `shas` holds the base blob. `ai-setup-audit`'s freshness check re-offers it as CHANGED the moment upstream's SKILL.md hash differs.

1. On CHANGED, diff the base against upstream and apply the hunks to the verbatim block:
   `gh api repos/mattpocock/skills/git/blobs/2eb98a51b97bb5bac461a26ad14828eeac827909 --jq .content | base64 -d > /tmp/handoff.base`
   `gh api repos/mattpocock/skills/contents/skills/productivity/handoff/SKILL.md --jq .content | base64 -d > /tmp/handoff.new`
   `diff /tmp/handoff.base /tmp/handoff.new`
2. Update the base blob and HEAD above, and add the new upstream hash to `shas` so the audit goes quiet until the next edit.
