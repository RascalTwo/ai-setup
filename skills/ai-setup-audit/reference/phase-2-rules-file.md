## Phase 2: Rules File Audit (AGENTS.md)

`AGENTS.md` is the single rules file both agents load every session. Review it **section by section** (by top-level heading).

For each section, evaluate:

1. **Staleness** — Does this still apply? Referencing outdated tools, versions, or workflows?
2. **Redundancy** — Does this duplicate something an agent already does by default? Be honest about built-in vs. unsure — if unsure, say so. Note behavior can differ between Claude and Codex; flag instructions that only make sense for one.
3. **Duplication across files** — Is the same instruction repeated in AGENTS.md and a per-project CLAUDE.md/AGENTS.md? It probably belongs in one place.
4. **Demote to memory?** — Niche or situational? Better as a basic-memory note retrieved on demand than loaded every session? Good candidates: instructions that apply to <10% of sessions.
5. **Promote from memory?** — Are there basic-memory notes retrieved so often they should just be in AGENTS.md? Check the Phase 0 usage report (basic-memory MCP frequency) or ask.
6. **Missing references** — Should this section point to a skill, memory note, or MCP server? If a section describes a workflow that has a corresponding skill, it should name that skill.
7. **No-op?** — Does this section actually change behavior, or does it describe what the
   model would do anyway? A rule with no observable effect costs context every session and
   pays nothing. Test it: name the concrete action it changes, or the wrong thing that
   happens without it. If neither can be named, it is a no-op — propose deleting it.

   **This check lives here and NOT in a transcript-mining pipeline on purpose.** Mining
   session transcripts and ranking by recurrence can only find problems that *happened*. A
   no-op instruction produces no moment to mine, forms no cluster, and never becomes a
   proposal — even when the miner reads `AGENTS.md` verbatim as context. You cannot detect
   the absence of an event by mining events. Mining is event-driven; this audit is
   state-driven, and only a pass over the static file finds an instruction that never fires.
   Do not "consolidate" this into a miner; it structurally cannot work there.

**Counts and lists drift when the thing they describe grows.** After any edit that adds or
removes an item, grep the file for the number ("all four", "three shape rules", "ten stops")
and for prose that re-enumerates the set. Adding one row to §4's table on 2026-08-30
silently falsified "Claude Code has all four" two lines below it.

Present each recommendation one at a time. Wait for the user's decision before moving on.

