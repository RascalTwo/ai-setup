## Phase 6: Basic-Memory Audit

Use the basic-memory MCP tools to inventory all notes. For each note:

1. **Staleness** — Content outdated? Check dates and accuracy.
2. **Duplicates** — Overlapping notes? Use `search_notes` to find near-duplicates.
3. **Dead references** — Links to notes, files, or skills that no longer exist? (Watch for references to the old `claude-audit` name → now `ai-setup-audit`, and to any renamed skill.)
4. **Linkability** — Related notes not yet linked? Propose wiki-links.
5. **Cross-ecosystem references** — Should this note reference a skill or AGENTS.md section, or vice versa?
6. **Promote to AGENTS.md?** — Retrieved so often it belongs in the rules file?
7. **Demote from AGENTS.md?** — Verify Phase 2 demotion candidates and offer to create the notes.

Present recommendations one at a time.

## Phase 7: Ecosystem Links Summary

Final cross-cutting pass. You've reviewed everything individually — now look at the connections.

1. **Map the reference graph.** List references across the ecosystem:
   - AGENTS.md → skills, subagents, memory, MCP
   - Skills → other skills, memory, files
   - Subagents → skills, sibling subagents (scope-boundary references)
   - Memory → other memory, skills
   - Mark each healthy (target exists) or dead (target missing).
2. **Dead links.** Summarize all dead references found across phases; address any not yet handled.
3. **New link opportunities.** Propose cross-references that strengthen the setup (a skill that does X should reference the memory note about X; an AGENTS.md section about workflow Y should name the skill for Y; two related notes should link).
4. **Session summary.** List all changes made this session: rules-file edits, skills added/modified/removed, MCP servers changed, memory notes touched, links added.

Present recommendations one at a time.

