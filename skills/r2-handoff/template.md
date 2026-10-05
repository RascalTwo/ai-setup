# Handoff sections

Every handoff opens with one **lineage** line, before section 1, so a successor can find the session it came from and walk the chain back:

`Lineage: from session <id> · transcript <path> · cwd <dir> · <date> · continued from: <handoff path | none> · earlier: <oldest path → … → newest path | none>`

- **id**: the session the handoff describes: your own `$CLAUDE_CODE_SESSION_ID`, or in rescue mode the rescued session's id. "unknown" only when neither exists (e.g. Codex).
- **transcript**: `ls ~/.claude/projects/*/<id>.jsonl`, checked to exist.
- **continued from**: the handoff this session itself started from (its first user message names it), else "none".
- **earlier**: the breadcrumb trail, on this same line, oldest first. Copy the `earlier` list from the handoff you continued from, then append that handoff's own `continued from` path unless it is "none". Open only the handoff you continued from, never the older ones. Temp directories get cleaned, so `ls` each path and write "(gone)" after any that no longer exists; keep it in the trail anyway, so the chain stays countable. "none" when this session did not start from a handoff.

Every handoff covers these, in this order. A section with nothing to say says "none". Mark anything inferred "(inferred)" and anything verified on disk just now "(checked now)".

1. **Goal**: what the user was trying to achieve, and how the goal evolved.
2. **Timeline**: 10-20 bullets in order, local time.
3. **State at the end**: done and verified, half-done, failing or blocked; what was running or in flight; the last user message, verbatim.
4. **Files, repos, services, commands touched**: absolute paths, each checked to exist; `git status --short` and `git log --oneline -5` for every repo touched.
5. **Decisions and open questions**: what the user decided; what they still owe.
6. **Failed or rejected approaches, and retracted claims**: what was tried and dropped, with the exact symptom and the reason; claims the assistant made that later proved false, so a successor does not trust them.
7. **User preferences and constraints**: stated in conversation, that a successor must respect.
8. **Next steps**: ordered, each small enough to start on.
9. **Gotchas**.
