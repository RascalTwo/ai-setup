# Keep coined terms in AGENTS.md, not a glossary file

Status: Accepted, 2026-11-14

## Context and Problem Statement

Matt Pocock's skills keep a project's domain words in a root `GLOSSARY.md` (`CONTEXT.md` before mattpocock/skills 1.3.0), and the global rules followed that. In practice the files went unread and unmaintained. Of about 18,400 past Claude Code sessions, 113 read or edited any `CONTEXT.md` or `GLOSSARY.md`, and most of those were agent briefs that share the name, not glossaries. timeline-studio's glossary was read in 3 sessions and touched in 15 of its 197 commits. Four repos' glossaries were still named `CONTEXT.md`, invisible to Pocock's skills after the rename, and nobody noticed. Nothing loads a glossary file unless a skill tells it to, and Pocock's docs call automatic invocation of `domain-modeling` its weakest part. Meanwhile `r2-adr` already records any naming choice another developer would question.

## Decision

Repos keep no glossary file. A word an outsider wouldn't know (coined, renamed or redefined) gets one line in a `## Terms` section of the repo's `AGENTS.md`, updated in the same change that coins it. `AGENTS.md` is loaded every session, so the terms get read without a skill having to fire. A naming choice someone would question also gets an ADR, which keeps the why. The global "Domain docs" line redirects every Pocock skill that reads or writes `GLOSSARY.md` to that Terms section, so the installed skills stay unedited and upgrade cleanly.

We accept leaving Pocock's convention: his skills' glossary steps now depend on the override line, and repos shared with people who use his skills unmodified will look different. Agent briefs that happen to be named `CONTEXT.md` (testing-poc, copilot-rollout, the sai-genai-accelerator clones) are out of scope and stay as they are.

## Alternatives Considered

- Rename every glossary to `GLOSSARY.md` and enforce updates with a lint and a review check: matches upstream, but it spends wiring on a file nothing reads automatically.
- Record terms only in ADRs: ADRs are append-only history, so learning what a word means now would mean finding every ADR that touched it and working out which supersedes which. Most coined words were never a questioned decision and would have no ADR.
- Keep glossary files only in repos dense with coined terms: still a file agents rarely open, and two conventions to remember.

## More Information

- Decided in the grill `~/.agents/state/viz/grill-glossary/` on 2026-11-14; Timeline Studio task `ai-tighten-adr-glossary-use`.
- Upstream rename: mattpocock/skills #1120 (CHANGELOG, 1.3.0).
- Revisit if Claude Code or Pocock's skills start loading a glossary file automatically.
