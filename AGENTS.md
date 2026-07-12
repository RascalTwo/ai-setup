# Global AI Agent Preferences

## 1.  Text-to-Speech Input

I often use voice/text-to-speech to give commands. This means:
- **Assume homophones may be wrong**
- **When a command is ambiguous or unusual**, don't act with full confidence — pause and confirm with me before proceeding.
- **Prefer the interpretation that makes the most contextual sense** for the current task, but flag it: e.g. *"I'm interpreting 'mark as red' as 'mark as read' — is that right?"*

## 2. Evidence-Based Claims

All claims that are non-obvious, consequential, or could be wrong — especially version-specific behavior, API details, configuration, or anything that may have changed since training — must be backed by evidence.

### Sourcing

- **Default: active-light** — do a quick verification before stating.
- **High-stakes claims** — escalate to active-heavy: dig through official docs, changelogs, GitHub releases.
- **When verification tools fail** — fall back to passive: state the claim with explicit uncertainty language.

### Confidence & Citation

- When confidence is high and the source is primary, keep the text clean — no citation clutter.
- When uncertain or the source is weak, lead with uncertainty language ("I believe...", "As of my training data...").
- When citing a source, use this format:

  📎 [`Source Name`](url) 🟢 `wayfinding: Ctrl+F term, section name, or heading ` 📎

- Evidence quality tiers:
  - 🟢 **Primary** — official docs, source code, API responses, changelogs
  - 🟡 **Secondary** — blog posts, articles citing primary sources, well-evidenced Stack Overflow answers
  - 🔴 **Tertiary** — forum posts, unverified comments, training data recall

### No Confidence Shortcut

High confidence from training data is not a reason to skip sourcing. When answering knowledge questions (how does X work, what does Y do, etc.), always run the evidence pipeline even if you "already know" the answer:

1. **basic-memory** — check for prior research on the topic.
2. **Domain MCP tools** — if a relevant source exists, query it.
3. **Web/other sources** — if the above don't cover it.
4. **Training data** — use as fallback or to synthesize/contextualize results from above, never as the sole source when primary sources are available.

Training recall feels authoritative but it's 🔴 tertiary. Don't let familiarity with a topic bypass the pipeline.

## 3. Planning & Verification

Every plan, action, or deliverable — code or otherwise — must include a verification phase before it can be considered done. Verification is proportional to the action: a one-liner change gets a one-liner check.

### Stress-Test Plans with Grilling

Before finalizing a plan, invoke the `grilling` skill to stress-test it with the user. The grilling phase surfaces assumptions, edge cases, and gaps that are cheaper to find before implementation than during it.

### Grilling-to-Plan Bridge

When a grilling or review phase surfaces a behavioral gap or edge case in existing code, immediately evaluate whether it blocks or changes the implementation plan. Don't defer it as "interesting finding" — ask: "Does this affect any code I'm about to write or any test I'm about to depend on?" If yes, address it in the plan before starting implementation.

### Verify Current State Before Changing It

Before modifying behavior, verify the current state empirically — run the service, hit the endpoint, observe the response. This establishes a "before" baseline so the "after" verification is meaningful, not assumed.

### Verification Format

Present verification as a Given/When/Then checklist with markdown checkboxes:

- [ ] **Given** [precondition], **when** [action], **then** [expected outcome]

### Execution

1. **Auto-execute** what can be automated (run commands, hit endpoints, check output).
2. **AI-assisted** — for subjective or qualitative checks, spawn a subagent to review/critique the output against stated criteria.
3. **Human** — only when it truly requires human eyes, judgment, or physical access. Present these as unchecked items for the user.
4. **Empirical first** — when a verification can be tested by simply triggering the condition and observing the result, do that before researching configuration or internals. Run the experiment, then investigate only if the result is ambiguous.

Track verification steps using the harness's task-tracking tools during execution.

### When Verification Fails

- If the fix is **within the scope and spirit of the original plan**, fix it and re-verify.
- If the fix would **change scope, direction, or significantly increase complexity**, stop and escalate to the user for approval.

## 4. Subagent Delegation

Delegate to subagents when output would be lengthy and you don't need line-by-line, or when 3+ independent tasks can run in parallel. Keep work inline when it's quick/targeted or the output directly feeds your next action.

### Context Protection

Before reading a file or running a command inline, ask: "Do I need this in my working memory, or just the answer?" If just the answer, delegate to a subagent. Never read large files inline when you only need specific information — use Grep or an Explore agent instead.

### Subagent Invocation Quality

Most subagent failures are invocation failures, not execution failures. Every subagent dispatch MUST include:
- **Specific scope** — not "fix auth" but "fix OAuth redirect loop in `src/auth/callback.ts`"
- **File references** — include paths to relevant code
- **Success criteria** — what "done" looks like
- **Full context** — subagents cannot ask clarifying questions mid-task; give them everything they need upfront
- **Whether to write code or just research** — be explicit about expected output

## 5. Skill & MCP-First Resolution

Before attempting any task ad-hoc, check two things:

1. **Skills** — scan the available skills list (shown in system reminders) for a match.
2. **MCP servers & tools** — scan the available MCP tools (shown in system reminders; load any deferred ones your agent supports) for a server that already handles the domain.

### Skills Priority

- **Meta/ecosystem skills** like `find-skills`, `skill-creator`, `update-config` — these handle the agent's own configuration and should be the first resort for any "how do I set up / install / configure X" question.
- **Domain skills** that match the task domain.

### MCP Priority

- **Domain MCP servers** — if an MCP server exists for the service or domain, use it before writing custom API calls, scripts, or browser workarounds. The session's available-MCP list (in system reminders) is the source of truth for what's loaded.
- **Discovery** — MCP tools may be deferred. Load any deferred tools matching the domain before falling back to ad-hoc approaches.

### General Rule

If a skill or MCP tool exists that covers the task, invoke it before writing any custom solution. A purpose-built skill or MCP integration will almost always outperform ad-hoc improvisation.

**Trip-wire:** if you're about to write ad-hoc code to interact with an external service — a bash script, a `curl`, an `npx`, a `gh` command, a Python one-off — stop and use the `find-skills` skill and check for MCP tools owning that domain first. Ad-hoc code is a last resort, not a first resort. If you find yourself writing a 20-line shell script to do what a skill could do in one invocation, that's a policy violation — back up and use the skill.

### Documentation Pre-flight

Before using a skill or MCP tool for the first time in a session, do a quick reconnaissance:
- **Skills** — if a skill references other skills in "See Also" or "Prerequisites", read the referenced docs before attempting ad-hoc commands.
- **MCP tools** — if an MCP server offers multiple related tools, load their schemas and understand the available operations before guessing at parameters or inventing workarounds.

One reconnaissance step is cheaper than 4+ failed attempts from guessing syntax.

## 6. Tool Hierarchy

When automating tasks, always follow this priority order:

1. **CLI first** — if a command line tool exists for the task, use it.
2. **Browser tasks → browser-automation tools** — for anything browser-based, use your agent's browser-control tools first.
3. **Non-browser GUI tasks → desktop-control** — if it's a GUI but not a browser, use your agent's desktop/computer-use tools.
4. **Fallback** — if browser tools fail or are insufficient, fall back to desktop-control.

## 7. Global Memory

Persistent memory is managed by **basic-memory** (MCP server). Use its MCP tools (`write_note`, `search`, `build_context`, etc.) for all memory operations — save, read, update, and forget. Memory files live in `~/basic-memory/`.

### Proactive Retrieval

Memory is never injected automatically — it must be actively searched. Basic-memory is step 1 of the §2 evidence pipeline; this section adds basic-memory-specific triggers on top of that. Triggers for a memory search:
- **Session start (MANDATORY)** — on the very first user message, before any other tool call, run `mcp__basic-memory__search` with the project name or topic. This is not optional even if the task seems simple — it's one tool call and prevents redundant research.
- **Before configuring or debugging tools/infra** — prior troubleshooting notes may exist.
- **When a subagent would otherwise be needed for knowledge lookup** — memory is faster.

If no results come back, proceed normally. The cost of an empty search is one tool call; the cost of missing existing knowledge is a wasted subagent or repeated mistakes.

## 8. Research / Web Fetch Failures

If web search or fetching a URL fails (e.g. 403, bot blocking, access denied), do **not** give up. Instead:
- Use browser-automation tools to navigate to the site or perform the search directly in the browser.
- Fall back to desktop-control if browser tools also fail.

## 9. Image Reading — Local-Vision-First

A native image `Read` adds ~1–2k vision tokens to context **every turn**, and they accumulate across a session. A local Ollama vision model returns small text/JSON instead, at ~0 Claude vision tokens — on hardware already owned.

**Route by intent before reading an image:**

- **Structured / known extraction → use the `read-image-locally` skill.** HUD/dashboard values, table contents, log/screenshot text, error messages, reading specific labeled fields, "what does this say/show". The skill wraps a tiered local reader (`gemma4:e4b` → `gemma4:12b`); on `LOCAL_VISION_FAILED` it tells you to read natively.
- **Holistic visual judgment → read natively with `Read`.** Layout/aesthetics, "does this look right", subtle/ambiguous scenes, dense unfamiliar UIs, "why does this look off". A small local model gives a generic caption that silently misses these.

The intent lives in the prompt: read-image-locally is only as good as the specific extraction instruction handed to it — never ask it for a generic caption. This policy applies to any agent that reads this file (Claude Code, Codex) and is delivered by prompting (this section), not a hook. It never blocks — routing is your call.

## 10. Hard-won gotchas (cross-project)

- **Never run parallel browser-automation agents.** There is one shared browser instance — concurrent browser/desktop-control agents collide. Serialize browser work.
- **Don't pipe a long-running/background command through `head`/`tail -f`.** The reader closes early and the producer dies on SIGPIPE. Redirect to a file and read that instead.
- **I use several GitHub accounts under one `gh` login.** The active account may not have access to a given repo — a push/clone/API call fails with "Repository not found" or a GraphQL "Could not resolve to a Repository" even though the repo exists. On any such access error, run `gh auth status` to see the logged-in accounts and `gh auth switch -u <account>` to the one that owns/can-reach the repo, then retry. Don't assume the repo is missing.

## graphify

When using the `graphify` skill (any input → knowledge graph; trigger `/graphify`), run its backend on **local ollama with `qwen2.5-coder:7b`** — not Claude subagents or Gemini.

# Agent skills (Matt Pocock engineering pipeline) — global config

This is the `## Agent skills` config that `to-spec`, `to-tickets`, `implement`, `triage`, `wayfinder`, and `qa` expect ("should have been provided to you"). Set globally here — do **not** run `setup-matt-pocock-skills` per repo. A project's own CLAUDE.md overrides this only if that repo genuinely tracks work elsewhere.

- **Issue tracker: local markdown** (not GitHub/GitLab). Issues and specs live under `.scratch/<feature-slug>/` in the current repo — spec at `spec.md`, one ticket per file at `issues/NN-slug.md` (numbered from `01`, blockers first), triage state on a `Status:` line, comments appended under `## Comments`. Wayfinder maps at `.scratch/<effort>/map.md`. Full convention (read on demand only when doing pipeline work): `~/.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md`.
- **Triage labels: canonical defaults** — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` (label string = role name, no remapping).
- **Domain docs: single-context** — one `CONTEXT.md` glossary + `docs/adr/` at the repo root.
