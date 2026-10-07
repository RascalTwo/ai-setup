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

Verify everything you assert or produce before "done", in proportion to the stakes (a one-line change gets a one-line check; an aside gets a clause of uncertainty).

- **Grill visually:** before finalizing a plan, run `grill-me-viz` (plain `grilling` only where viz can't run).
- **Steelman consequential calls:** before a hard-to-reverse or high-stakes decision (architecture, dependency, delete/migrate, an expensive direction), run `steelman`; I judge. Skip reversible calls.
- **Gap → plan:** if review finds a gap that affects code you're about to write or a test you rely on, fix the plan first.
- **Baseline first:** observe current behavior empirically (run it, hit it) before changing it or reading internals.
- **Rival hypotheses:** name 2+ explanations; design the check to exclude one, not confirm one.
- **Format:** `- [ ] **Given** X, **when** Y, **then** Z` plus a **falsifier**. No possible falsifier = not a check.
- **Execute:** auto-run what's automatable; subagent for subjective checks; leave human-only items unchecked.
- **On failure:** in scope → fix and re-verify; scope/direction change → stop and escalate.

## 4. Delegation & Orchestration

Each subagent first writes ~28k tokens of fresh context, so spawn one only when it saves more than that. Delegate when the work would pour well over ~30k tokens of output into this context and you need only the conclusion, or when 3+ independent tasks can run in parallel. Keep inline: single lookups (one grep, one file region, one command) and anything whose output feeds your next step. For a wide search use Explore, not general-purpose. Never fork for research: a fork copies this whole context.

Every dispatch carries: a specific scope with file paths, success criteria, full context (they can't ask), and whether to write code or only research.

**Route by who holds the plan (literal names):**

| The work | Mechanism |
|---|---|
| Side task whose detail I won't need again | **subagent** |
| Fixed plan, ~8+ same-shaped items, or findings to cross-check | **dynamic workflow** (no mid-run input) |
| Evolving plan, workers must challenge each other, or I steer mid-flight | **agent team** |
| A session you opened yourself | **`SendMessage`** |
| Work that must outlive this context or run unattended | **handoff doc → fresh agent**: ask me to run `/r2-handoff`, then pass its PATH (never contents) to `claude --bg` or `delegate-to-codex` |

**Codex has subagents and handoff only**; route the rest to subagents or inline there.

Shape rules: fan out independent items only; partition by file (workflow agents can take worktrees, teammates can't); taste doesn't fan out, so a convention with no test gets a review pass over the finished diff.

## 5. Skill & MCP-First Resolution

Before any ad-hoc approach, check the listed **skills**, then **MCP tools** (load deferred ones). If one covers the task, use it. About to hand-write code against an external service (`curl`, `npx`, `gh`, a script)? Check skills and MCP first; `find-skills` only if none fits. First use in a session: read the skill's prerequisites or load related tool schemas before guessing.

## 6. Tool Hierarchy

After §5 finds nothing: CLI first, then browser-automation tools for anything in a browser, then desktop control for other GUIs (and as the browser fallback). When a web search or fetch fails (403, bot blocking, access denied), don't give up: drive the site in the browser, then desktop control.

## 7. Global Memory

**basic-memory** (MCP) holds knowledge with **nowhere better to live**. Never auto-injected, so search it:
- **Session start (mandatory):** search the project/topic before any other tool call, unless the project's rules file says otherwise.
- Before configuring or debugging tools/infra, and instead of spawning a subagent for a knowledge lookup.

**Write to one place, never both:** if the work is already producing markdown (docs, README, `provenance/`, this file), the knowledge goes there; if it isn't, it goes in basic-memory. Wanting both means the markdown is missing it: propose adding it to the file.

## 8. Image Reading — Local-Vision-First

A native image `Read` adds ~1–2k vision tokens every turn and accumulates; the local Ollama reader returns text/JSON at ~0 Claude vision tokens. Route by intent:
- **Structured/known extraction → `read-image-locally` skill** — HUD/dashboard values, tables, log/screenshot text, errors, specific labeled fields. Give it a specific instruction, never a generic caption; on `LOCAL_VISION_FAILED` read natively.
- **Holistic visual judgment → native `Read`** — layout/aesthetics, "does this look right", ambiguous scenes, dense UIs. A local model's generic caption silently misses these.

## 9. Hard-won gotchas (cross-project)

- **Don't pipe a long-running/background command through `head`/`tail -f`.** The reader closes early and the producer dies on SIGPIPE. Redirect to a file and read that instead.
- **I use several GitHub accounts under one `gh` login.** The active account may not have access to a given repo — a push/clone/API call fails with "Repository not found" or a GraphQL "Could not resolve to a Repository" even though the repo exists. On any such access error, run `gh auth status` to see the logged-in accounts and `gh auth switch -u <account>` to the one that owns/can-reach the repo, then retry. Don't assume the repo is missing.
- **macOS keychain reads can hang headlessly.** `security find-internet-password`/`find-generic-password` may block forever on a keychain approval prompt. For git-host credentials (e.g. a GitLab PAT), use `git credential fill` instead (`printf 'protocol=https\nhost=<host>\n\n' | git -C <repo> credential fill`) — the osxkeychain helper is already approved for git and returns instantly. Cache to a 0600 scratchpad file rather than re-reading.
- **`find` in the Bash tool is an rtk wrapper.** It rejects compound predicates and actions (`-not`, `-exec`, `-delete`) yet exits 0, so a chained command silently does nothing. Use **`/usr/bin/find`** for anything beyond a bare name search.

## ponytail — always-on (coding tasks)

**Invoke the `ponytail` skill on the first coding task of a session** (write/add/refactor/fix/review/choose deps); it stays on after that. Not for prose or research; yields to explicit thoroughness.

## voicemode

Voicemode echo is off: never echo voice turns into chat as `> **ASSISTANT (voicemode):**` blockquotes (`converse` defaults it on; this line is the standing "disable voicemode echo").

Only two literal triggers start speech. A long answer, a conversational question or dictated input never does (Mac dictation looks like typing). Honor obvious mis-transcriptions ("voice mod", "voiced mode", "speak at", "speaking it"), never guessed intent.

| I say | You call | What happens |
|---|---|---|
| **"voice mode"** | `converse(message=…)`, default `wait_for_response=true` | Full conversation; keep looping until "end voice mode" / "stop voice mode" / "back to text". |
| **"speak it"** / **"speak that"** | `converse(message=…, wait_for_response=false)` | Speak once, return. No listening, no loop, no conch. |

One-shot rules:
- Still write the full text answer. Speech is an extra channel, never a replacement.
- Speak a spoken-shaped version: two or three sentences, no code, paths, markdown, lists or URLs. For a code answer, speak the gist.
- Multi-part: `turns` with `say` verbs only (no `ask`), so parts pipeline without dead air.
- Don't ask whether to speak; the trigger already said so.

## Agent skills (Matt Pocock pipeline) — global config

The `## Agent skills` config that `to-spec`, `to-tickets`, `triage`, `wayfinder`, `code-review` and `ask-matt` expect. Set globally — do **not** run `setup-matt-pocock-skills` per repo; a project's own CLAUDE.md overrides only if that repo genuinely tracks work elsewhere.

- **Issue tracker:** local markdown under `.scratch/<feature-slug>/`, not GitHub/GitLab.
- **Triage labels:** canonical defaults (label string = role name, no remapping).
- **Domain docs:** single-context — one `CONTEXT.md` glossary + `docs/adr/` at the repo root.
- Full conventions (richer than this summary): `~/.agents/skills/setup-matt-pocock-skills/{issue-tracker-local,triage-labels,domain}.md` — read only when doing pipeline work.
