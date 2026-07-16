# Global AI Agent Preferences

## 1.  Text-to-Speech Input

I often use voice/text-to-speech to give commands. This means:
- **Assume homophones may be wrong**
- **When a command is ambiguous or unusual**, don't act with full confidence — pause and confirm with me before proceeding.
- **Prefer the interpretation that makes the most contextual sense** for the current task, but flag it: e.g. *"I'm interpreting 'mark as red' as 'mark as read' — is that right?"*

## 2. Evidence-Based Claims

Back any claim that's non-obvious, consequential, or could be wrong (version behavior, API details, config, anything post-training) with evidence — even when you "already know" it. High training-data confidence is 🔴 tertiary, not a reason to skip.

**Pipeline (in order):** 1) basic-memory 2) domain MCP tools 3) web/other sources 4) training data — fallback/synthesis only, never sole source when primary exists.

**Effort:** default active-light (quick verify before stating); high-stakes → active-heavy (official docs, changelogs, releases); tools fail → passive (state with explicit uncertainty, "I believe…").

**Citation:** high confidence + primary → clean, no clutter; weak/uncertain → lead with uncertainty. When citing:
  📎 [`Source Name`](url) 🟢 `wayfinding: Ctrl+F term or heading` 📎
  🟢 primary (docs, source, API, changelogs) · 🟡 secondary (blogs citing primary, good SO, memory) · 🔴 tertiary (forums, unverified, training recall)

## 3. Planning & Verification

Every plan/action/deliverable needs a verification phase before "done," proportional to the change (one-liner change → one-liner check).

- **Grill first:** before finalizing a plan, invoke the `grilling` skill to surface assumptions/edge cases/gaps cheaply.
- **Steelman consequential calls:** before committing to a hard-to-reverse or high-stakes decision (architecture, dependency choice, delete/migrate, picking a direction over expensive alternatives), invoke the `steelman` skill — it argues the strongest case *for* and *against*, surfaces the cruxes, then I judge. Grilling shapes the plan; steelman pressure-tests the decision. Skip trivial/reversible calls (proportionality, as above). A steelman won't self-invoke — that's why it lives here as a standing rule.
- **Grilling→plan bridge:** if grilling/review surfaces a gap in existing code, immediately ask "does this affect code I'm about to write or a test I'll depend on?" If yes, fix the plan before implementing — don't file it as "interesting finding."
- **Baseline before changing:** verify current behavior empirically (run it, hit the endpoint, observe) so the "after" check is real. Empirical first — trigger the condition and observe before researching internals.
- **Format:** `- [ ] **Given** X, **when** Y, **then** Z`. Track steps with the harness task tools.
- **Execute:** auto-run the automatable; subagent for subjective/qualitative checks; leave true human-only items unchecked for me.
- **On failure:** in-scope → fix and re-verify; scope/direction/complexity change → stop and escalate.

## 4. Subagent Delegation

Delegate when output is lengthy and you need the answer not the detail, or 3+ independent tasks can run in parallel. Keep inline when quick/targeted or the output directly feeds your next step. Before reading a file/running a command inline, ask "do I need this in working memory, or just the answer?" — if just the answer, delegate (use Grep/Explore, never read large files inline for one fact).

Most subagent failures are invocation failures. Every dispatch includes: specific scope (not "fix auth" but "fix OAuth redirect loop in `src/auth/callback.ts`"), file paths, success criteria, full upfront context (they can't ask mid-task), and whether to write code or just research.

## 5. Skill & MCP-First Resolution

Before any ad-hoc approach, check the system-reminder lists — **skills** first, then **MCP servers/tools** (load deferred ones). If a skill or MCP tool covers the task, invoke it before writing any custom solution — it almost always beats improvisation.

**Trip-wire:** about to write ad-hoc code against an external service (bash, `curl`, `npx`, `gh`, a Python one-off)? Stop — use `find-skills` and check for an owning MCP tool first. A 20-line shell script doing what a skill does in one call is a policy violation.

**First use in a session:** recon before guessing — read a skill's "See Also"/"Prerequisites"; load an MCP server's related tool schemas. One recon step beats 4+ failed guesses.

## 6. Tool Hierarchy

When automating tasks, always follow this priority order:

1. **CLI first** — if a command line tool exists for the task, use it.
2. **Browser tasks → browser-automation tools** — for anything browser-based, use your agent's browser-control tools first.
3. **Non-browser GUI tasks → desktop-control** — if it's a GUI but not a browser, use your agent's desktop/computer-use tools.
4. **Fallback** — if browser tools fail or are insufficient, fall back to desktop-control.

## 7. Global Memory

**basic-memory** (MCP) manages all persistent memory — `write_note`, `search`, `build_context`, etc.; files in `~/basic-memory/`. Never auto-injected — search it. It's step 1 of the §2 pipeline; extra triggers:
- **Session start (MANDATORY)** — first user message, before any other tool call, `mcp__basic-memory__search` the project/topic. Not optional even for simple tasks.
- **Before configuring/debugging tools/infra** — prior notes may exist.
- **When you'd otherwise spawn a subagent for a knowledge lookup** — memory is faster.
Empty result → proceed normally.

## 8. Research / Web Fetch Failures

If web search or fetching a URL fails (e.g. 403, bot blocking, access denied), do **not** give up. Instead:
- Use browser-automation tools to navigate to the site or perform the search directly in the browser.
- Fall back to desktop-control if browser tools also fail.

## 9. Image Reading — Local-Vision-First

A native image `Read` adds ~1–2k vision tokens every turn and accumulates; a local Ollama model returns text/JSON at ~0 Claude vision tokens. Route by intent:
- **Structured/known extraction → `read-image-locally` skill** — HUD/dashboard values, tables, log/screenshot text, errors, specific labeled fields. Tiered reader (`gemma4:e4b`→`gemma4:12b`); on `LOCAL_VISION_FAILED` read natively. Give it a specific instruction, never a generic caption.
- **Holistic visual judgment → native `Read`** — layout/aesthetics, "does this look right", ambiguous scenes, dense UIs. A local model's generic caption silently misses these.

## 10. Hard-won gotchas (cross-project)

- **Never run parallel browser-automation agents.** There is one shared browser instance — concurrent browser/desktop-control agents collide. Serialize browser work.
- **Don't pipe a long-running/background command through `head`/`tail -f`.** The reader closes early and the producer dies on SIGPIPE. Redirect to a file and read that instead.
- **I use several GitHub accounts under one `gh` login.** The active account may not have access to a given repo — a push/clone/API call fails with "Repository not found" or a GraphQL "Could not resolve to a Repository" even though the repo exists. On any such access error, run `gh auth status` to see the logged-in accounts and `gh auth switch -u <account>` to the one that owns/can-reach the repo, then retry. Don't assume the repo is missing.
- **macOS keychain reads can hang headlessly.** `security find-internet-password`/`find-generic-password` may block forever on a keychain approval prompt. For git-host credentials (e.g. a GitLab PAT), use `git credential fill` instead (`printf 'protocol=https\nhost=<host>\n\n' | git -C <repo> credential fill`) — the osxkeychain helper is already approved for git and returns instantly. Cache to a 0600 scratchpad file rather than re-reading.

## ponytail — always-on (coding tasks)

Ponytail `full` is the standing default for all coding work (write/add/refactor/fix/review/choose deps), no invocation — laziest working solution, YAGNI, stdlib over custom, native over deps. NOT for prose/research/knowledge; yields to explicit thoroughness. See the `ponytail` skill for method + lite/ultra.

## graphify

When using the `graphify` skill (any input → knowledge graph; trigger `/graphify`), run its backend on **local ollama with `qwen2.5-coder:7b`** — not Claude subagents or Gemini.

# Agent skills (Matt Pocock engineering pipeline) — global config

This is the `## Agent skills` config that `to-spec`, `to-tickets`, `implement`, `triage`, `wayfinder`, and `qa` expect ("should have been provided to you"). Set globally here — do **not** run `setup-matt-pocock-skills` per repo. A project's own CLAUDE.md overrides this only if that repo genuinely tracks work elsewhere.

- **Issue tracker: local markdown** (not GitHub/GitLab). Issues and specs live under `.scratch/<feature-slug>/` in the current repo — spec at `spec.md`, one ticket per file at `issues/NN-slug.md` (numbered from `01`, blockers first), triage state on a `Status:` line, comments appended under `## Comments`. Wayfinder maps at `.scratch/<effort>/map.md`. Full convention (read on demand only when doing pipeline work): `~/.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md`.
- **Triage labels: canonical defaults** — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` (label string = role name, no remapping).
- **Domain docs: single-context** — one `CONTEXT.md` glossary + `docs/adr/` at the repo root.
