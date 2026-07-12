---
name: retro
description: Analyze a Claude Code conversation — the current one by default, or a past one — for mistakes, inefficiencies, and missed opportunities, then propose concrete self-improvements. Use this skill whenever the user says "retro", "retrospective", "what went wrong", "how could we improve", "analyze this session", "review this conversation", or asks you to reflect on your performance. Also trigger when the user asks you to identify mistakes, learn from errors, or improve your approach for next time — even if they don't use the word "retro". Also trigger for retroactive framings like "retro yesterday's session", "retro my work from last Tuesday", "go back and retro that debugging session", or when a scheduled/batch retro pass needs to run over prior sessions.
---

# Retro — Conversation Retrospective & Self-Improvement

You are performing a retrospective on a Claude Code conversation. Your goal is to identify what went wrong or could be improved, then propose improvements that actually prevent recurrence — not band-aids, but root-cause fixes.

The target can be the **current** conversation (default) or one or more **past** sessions. Step 1 picks the target; the rest of the flow is the same.

## Step 1: Select Target Session(s)

### Default: current session

If the user says "retro" / "retrospective" / "review this conversation" with no time reference, they mean the current session. Find its ID so the retro links back to it:

1. List `.jsonl` files in `~/.claude/projects/<project-slug>/` sorted by modification time (most recent first).
2. The most recently modified `.jsonl` file that is NOT a subagent session is the current conversation. The filename (without `.jsonl`) is the session UUID.
3. To confirm, you can check that the file's `sessionId` field matches its filename.

Record this session ID — it goes in the retro report. The conversation transcript is already in your context; proceed to Step 2.

### Past session(s)

If the user gives a session ID, a date, a date range, or any fuzzy time reference ("yesterday", "last Tuesday", "last week", "that debugging session from a couple weeks ago"), **delegate transcript fetching to the `get-session-transcript` skill.** Do not re-implement session lookup here — that skill already wraps the `ai-session-extractor` CLI and handles ID / date / range resolution.

After invoking `get-session-transcript`, you'll have:

- A YAML manifest listing every session pulled (session ID, project, start time, message count, filename).
- The full session body (or bodies, for a range), either on stdout or written to an output directory.

If the user gave a topic without a time signal, ask them to narrow to a date or range before extracting — don't scan the whole history.

Record the session ID (from the manifest) for each target — it goes in that session's retro report.

## Step 2: Analyze the Conversation

Scan the entire target session for issues in these categories. For the current session, "target" is your in-context conversation. For past sessions, "target" is the extracted transcript — rely on explicit markers (`USER:`, `ASSISTANT:`, `[tool: ...]`, `[tool-result]`, `[agent: ...]`) rather than memory of what happened.

### Errors & Failures
- Failed command or tool executions (wrong syntax, bad paths, missing dependencies)
- Incorrect code generated that needed fixing
- Wrong assumptions that led to wasted work

### Human Corrections
- Times the user stopped you mid-action to correct your approach
- Times the user had to tell you HOW to do something you should have known
- Times the user rejected a tool call or action
- Times the user expressed frustration or re-explained something

### Missed Opportunities
- Relevant skills that exist but weren't invoked (or were invoked late)
- Tools that would have been more appropriate than what was used
- Subagent delegation that should have happened but didn't (or vice versa)
- Information in CLAUDE.md that was ignored

### Inefficiencies
- Redundant tool calls or unnecessary file reads
- Context window waste (reading large files inline when a subagent would suffice)
- Going in circles or retrying the same failing approach
- Over-engineering or under-engineering relative to what was asked

### Positive Patterns (also capture what went well)
- Approaches that worked smoothly and should be reinforced
- Good tool/skill usage worth remembering

## Step 3: Generate Proposals — The Hard Part

This is where retros succeed or fail. A retro that identifies problems but proposes weak fixes is barely better than no retro at all.

### The Root Cause Rule

For every issue, ask "why?" until you hit something structural. The fix goes at the structural level, not the symptom level.

**Example of a weak proposal:**
- Issue: Used `cat` instead of Read tool
- Weak fix: "Remember to use Read tool next time"
- This is useless — it's just restating the mistake as advice.

**Example of a strong proposal:**
- Issue: Used `cat` instead of Read tool
- Root cause: No pre-flight habit of checking available tools before reaching for Bash
- Strong fix: Add a CLAUDE.md rule: "Before any file operation in Bash, pause and check if a dedicated tool exists (Read, Write, Edit, Glob, Grep)."

### Proposal Quality Requirements

Every proposal MUST meet these criteria:

1. **Complete, not vague.** Don't write "consider adding guidance about X." Write the actual guidance. If the proposal is a CLAUDE.md update, include the exact text to add. If it's a memory entry, write the full content. The person applying this proposal should be able to copy-paste, not interpret.

2. **Targets the root cause, not the symptom.** Ask: "If I apply this fix, does it prevent the *class* of problem, or just this one instance?" If it only prevents the exact same mistake in the exact same context, dig deeper.

3. **Preventative over reactive.** Prefer proposals that create guardrails, checklists, or pre-flight checks over proposals that say "remember to do X." Humans (and LLMs) don't reliably "remember" — systems and checks do.

4. **Consolidates patterns.** If two or more issues share a root cause, write one proposal that addresses the pattern, not separate proposals for each symptom. Call out the pattern explicitly.

5. **Appropriately scoped.** A one-off mistake in a niche situation doesn't need a global CLAUDE.md rule. A recurring pattern across sessions does. Match the weight of the fix to the weight of the problem.

### Proposals

Proposals can target any part of the Claude Code configuration — CLAUDE.md files, memory, skills, hooks, settings, agents, or anything else that shapes behavior. Use your judgment about the right mechanism for each fix. Every proposal must specify its **scope**: global (`~/.claude/`) or project (`.claude/` within a repo).

### The "So What?" Test

Before finalizing each proposal, ask: "If this proposal had been in place at the start of the session, would it have prevented or significantly reduced the issue?" If the answer is "maybe" or "not really," the proposal needs reworking.

## Step 4: Write the Report

Write the report to `<skill-root>/retros/`, where `<skill-root>` is the directory containing this `SKILL.md`. Resolve the path from this file's location — don't hardcode it, since the skill lives in `ai-setup/skills/retro/` and is symlinked into `~/.claude/skills/retro/`. The `retros/` subdirectory is the canonical, permanent home for every retro report; reports live alongside the skill so they're version-controlled with it and writes don't trigger `~/.claude/` permission prompts.

Before writing, check if `<skill-root>/retros/` exists (`ls <skill-root>/retros/`). Only create it (`mkdir -p <skill-root>/retros/`) if the check shows it doesn't exist.

**Filename format:** `YYYY-MM-DD_HH-MM_<project-slug>_<brief-topic>_<session-id>.md`

- Use the current date/time
- `<project-slug>` is derived from the project directory name (e.g., `genai-in-sd-se`)
- `<brief-topic>` is a 2-4 word slug summarizing the session's main activity

**Report structure:**

```markdown
# Retro: <Brief Description>

**Project:** <project directory path>
**Session ID:** <UUID from Step 1>
**Summary:** <1-2 sentence overview of what the session was about>

## Issues Found

### <Category>
- **Issue:** <What happened — cite the specific moment>
  **Impact:** <How it affected the session — wasted time, wrong output, user frustration>
  **Root Cause:** <Why it happened — dig past the surface>

(Repeat for each issue. Group by category from Step 2.)

## What Went Well

- <Pattern worth reinforcing and why>

## Proposed Improvements

### <Improvement title>
- **Type:** <what's being changed — e.g., memory, CLAUDE.md, skill, hook, settings, agents, etc.>
- **Scope:** <global | project>
- **Target file:** <exact path to file that would be created/modified>
- **Issues addressed:** <list which issues from above this fixes>
- **Change:** <The complete, ready-to-apply content. Not a description of what to add — the actual text.>
- **"So What?" check:** <One sentence explaining why this prevents the class of problem, not just this instance>

(Repeat for each proposed improvement.)
```

## Step 5: Present to the User

After writing the report, summarize the findings and proposed improvements in the conversation. Keep it concise — the full details are in the report file. For each proposal, include:
- What it fixes (reference the issue)
- The actual change (so they can approve without opening the file)
- Why it works at the root-cause level

**Do NOT apply any proposed changes yet.** Wait for explicit user approval. The user may approve all, some, modify them, or dismiss entirely.

## Step 6: Apply Approved Changes

Only after explicit user approval, apply the approved changes.
When a proposal involves saving knowledge/learnings, write it to basic-memory via `mcp__basic-memory__write_note` (or update an existing note with `mcp__basic-memory__edit_note`).

## Guidelines

- Be honest and specific. Vague observations like "could improve tool usage" are useless. Cite the exact moment and what should have happened instead.
- Don't pad the report. If the session went perfectly, say so — a short retro is fine.
- Every issue should map to at least one proposal. If you can't think of a fix, say so explicitly rather than silently dropping the issue.
- Distinguish between one-off mistakes and systemic patterns. Prioritize fixing patterns.
- Don't be defensive. The point is to get better, not to justify past actions.
- When multiple issues share a root cause, consolidate into one strong proposal rather than scattering weak ones.