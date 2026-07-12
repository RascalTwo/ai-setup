# Philosophy: Why This Setup Exists

This document explains the reasoning behind each component of the setup. The setup-prompt.md applies these; this file explains why they matter.

## CLAUDE.md — Global Behavior Rules

Claude Code is powerful out of the box, but it has consistent failure modes that surface across sessions. The global CLAUDE.md addresses these systematically:

### Text-to-Speech Input (Section 1)
I use voice input heavily. Claude occasionally misinterprets homophones or unusual phrasing and charges ahead with the wrong interpretation. This section forces a pause-and-confirm behavior for ambiguous input, which prevents wasted work.

> I do not use the /voice command, but rather https://handy.computer/

### Evidence-Based Claims (Section 2)
Claude confidently states things that are wrong — especially version-specific behavior, API details, and configuration that may have changed post-training. This section establishes a sourcing hierarchy (active-light → active-heavy → passive with uncertainty language) and a citation format so I can trace claims back to their source. The evidence quality tiers (Primary/Secondary/Tertiary) make it clear when a claim is well-grounded vs. speculative.

### Plan Verification (Section 3)
Without explicit verification steps, Claude considers work "done" when it finishes writing code — not when the code actually works. The Given/When/Then checklist format forces verification to be planned upfront and executed before completion. The escalation rules prevent scope creep during fixes.

### Context Protection (Section 4)
Claude's context window is finite and valuable. Without this rule, it reads entire files inline when it only needs one function, filling up context with irrelevant content. This section forces the "do I need this in working memory?" question before every read/command.

### Subagent Delegation (Section 5)
Subagent failures are almost always invocation failures — vague prompts, missing file paths, unclear success criteria. This section codifies what a good subagent dispatch looks like. The parallel threshold (3+ independent tasks) prevents both over-delegation and under-delegation.

### Skill-First Resolution (Section 6)
Claude defaults to ad-hoc improvisation even when a purpose-built skill exists. This section makes skill lookup the first step, not an afterthought. The meta-skill awareness (find-skills, skill-creator, etc.) prevents the common failure of trying to manually configure Claude Code when a skill already handles it.

### Tool Hierarchy (Section 7)
Without explicit priority ordering, Claude reaches for whichever tool comes to mind first. This section establishes CLI > Chrome MCP > computer-use as the default escalation path, ensuring the fastest and most reliable tool is tried first.

### Global Memory (Section 8)
Claude has no persistent memory by default. basic-memory provides it, but Claude won't search it unless told to. The proactive retrieval triggers ensure prior context is checked before starting work, preventing repeated research and recurring mistakes.

### Research Fallbacks (Section 9)
WebSearch and WebFetch regularly fail due to bot blocking. Without this rule, Claude gives up and says "I couldn't access that site." The fallback chain (Chrome MCP → computer-use) ensures the research actually happens.

## Settings

### Notification Hooks
When Claude finishes working or needs input, there's no visual indicator by default — you have to keep checking the terminal. The Stop hook (Glass.aiff sound) and Notification hook (macOS notification with Ping sound) solve this. You can walk away and know when to come back.

### Effort Level
Higher effort means Claude thinks longer before acting. For complex tasks, the difference in output quality is significant.

## Skills

### claude-audit
A phased, interactive audit of your entire Claude Code ecosystem. Checks CLAUDE.md files, skills, MCP servers, settings, and basic-memory for staleness, redundancy, dead references, and missed cross-references. It analyzes recent session transcripts to surface unused or failing components. Run it periodically to keep your setup clean.

### retro
A structured retrospective for the current conversation. Identifies errors, human corrections, missed opportunities, and inefficiencies — then proposes root-cause fixes (not band-aids). Proposals target CLAUDE.md sections, skills, memory notes, or settings. Creates a timestamped report in `~/.claude/retros/`. This is the primary feedback loop for improving your Claude Code experience over time.

### azure-container-app-logs
A diagnostic skill for Azure Container App deployment failures. When a health check times out or a container crash-loops, this skill walks through the steps to pull system events and application console logs from Log Analytics to find the root cause.

## Integrations

### Computer Use
Gives Claude the ability to see and interact with your desktop — native apps, GUI workflows, anything not in a browser. Useful for tasks in Maps, Notes, Finder, System Settings, or any third-party desktop app.

### Chrome Claude
Gives Claude DOM-aware access to Chrome — faster and more precise than computer-use for anything browser-based. Can read page content, fill forms, click elements, and navigate.

### Basic Memory
Replaces Claude's built-in memory (which is limited and opaque) with a file-based memory system you control. Notes live in `~/basic-memory/` as plain markdown, searchable and editable. Claude uses it for persistent context across sessions.

### Atlassian Confluence
Gives Claude read/write access to Confluence via OAuth. Useful for reading documentation, creating pages, and searching your team's knowledge base without leaving the terminal.
