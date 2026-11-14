---
disable-model-invocation: true
name: dream
description: Mine Claude Code session history for recurring mistakes and missed opportunities, and check basic-memory notes against evidence, then propose improvements to this AI setup and fixes to the notes for review. Use when the user says dream, run the dream, consolidate my sessions, what should I improve about my setup, or asks why the nightly dream did not run. Also for backfilling historical sessions. Replaces the retired retro and retro-catchup skills.
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    claude-code: [Stop, SessionEnd]
    launchd: nightly job
    ollama: nomic-embed-text embeddings
    git: proposal branches
  requires:
    commands: [claude, ollama, bun, jq]
---

# dream — autonomous setup improvement

This system watches how sessions actually go, finds the patterns, and proposes fixes to
the AI setup as git branches you thumbs-up in a dashboard. It runs nightly without asking.

**The one human touchpoint is the viz dashboard.** Everything before it is automatic;
nothing after it happens without an explicit approval.

## Why the previous system failed

`retro` produced 28 markdown reports containing ~89 proposals over two months. Zero were
ever aggregated or acted on, and it went dormant for 3.5 months without anyone noticing.
Three root causes, each fixed by a specific design choice here:

| failure | fix |
|---|---|
| Required manual invocation | launchd runs it nightly, unprompted |
| Per-session reports nobody aggregated | consolidation across sessions is the whole point; per-session artifacts are ephemeral |
| Died silently | the dashboard shows "last dream: N days ago" and turns alarming when stale |

## Architecture

**Capture — two stages: a deterministic funnel, then a judge.**

| stage | script | role |
|---|---|---|
| 1 | `scripts/prefilter.py` | deterministic, no model. Narrows the corpus and **over-collects on purpose** → `state/stage1/` |
| 2 | `scripts/score.py` | one `claude -p` call per batch. Judges each moment → `state/candidates/` |

Stage 1 has two writers — `scripts/scan.py` nightly (authoritative and idempotent) and
`hooks/stop.sh` every turn (pure optimization, incremental by message-uuid watermark). If
every hook fails forever the system still works. `state/processed.tsv` dedupes.

**Subagent transcripts (`scan.py --subagents`, opt-in).** Subagent output is nearly pure
assistant text, and assistant self-retraction is the highest-value signal class the recall
audit found — so `<session>/subagents/**.jsonl` is worth reading, but it is *not* a session.
There is no human in it: the "user" turn is a dispatch prompt written by another agent, so
stage 1 reads human turns as context only and emits **no `user`-role moments** from these
files. Measured, that suppression drops ~21,500 would-be "human signal" moments — 2.5× the
assistant yield — including briefs that read exactly like stated user preferences.
Moments are attributed to the **parent session** so they cluster with the work that produced
them, the ledger gives each file its **own key** (`<parent>/<rel-path>`), and `occurrences`
collapses one parent's fan-out to 1 so a single event cannot outrank a real recurrence.
Measured against the duplication hypothesis: **99.5% of subagent assistant moments are absent
from what stage 1 captures from the parent.** Full detail and numbers in `CONTRACTS.md`.

**Dispatch reports are a fallback, not a second source.** A successful `Task`/`Agent`
tool_result in the *parent* transcript is the report a subagent hands back, and stage 1 now
mines it — but `agent-<agentId>` from the harness's own footer is the stem of that subagent's
transcript, and **1,881 of 1,884 are on disk**, so `--subagents` has already read them.
Turning the path on adds **5 genuinely new moments to 99,137** while `--subagents` is on, and
1,237 while it is off. It exists so that capture degrades gracefully if subagent transcripts
stop being written, not because there is value being thrown away today.

**Why two stages.** The original single-stage keyword prefilter was audited by six
independent readers over 86 sessions and measured at 20–64% recall. It captured zero
assistant turns, and its capture rate rose monotonically with turn length (<20 words 0%,
200+ 79%) — it was a verbosity detector, keeping the narration and dropping the objections.
About 60 of 91 misses are unreachable by any pattern list, so the judge is not optional.
Stage 1 now admits *every* substantive human turn plus any assistant segment making a
first-person past-tense claim; stage 2 decides. See `CONTRACTS.md` for the full rules.

**Think.** `scripts/cluster.py` embeds candidates with local `nomic-embed-text` and groups
them by root cause across sessions — clustering is math, not an LLM call. `scripts/synthesize.py`
turns each cluster into one proposal with one `claude -p` call, ranked and capped by a blast
radius computed from how many distinct sessions the problem actually reached. Colliding
proposals are merged here, upstream, so git rarely sees a conflict.
`scripts/apply-proposals.sh` then has one headless `claude -p` per new proposal make its edit in a worktree and commits it on its `dream/` branch (basic-memory-only proposals get no branch; their note is written on approval).

**Repeated lookups.** Not every finding is a mistake. `scripts/lookups.py` finds discovery calls (a file read, a section `sed`'d out of a skill, a grep, an API probe) that ran in 3+ separate sessions in the last 30 days: each agent re-found what an earlier one already knew. Prefilter records each session's lookup signatures in the `skills/` sidecar; lookups.py writes the repeats to `candidates/_lookups.jsonl` as kind `lookup`; cluster.py groups them by the skill, tool or repo they read (not by embedding); synthesis gets each distinct lookup with its session count plus the size and headings of the files read, and proposes handing the answer over (a cheat sheet, a split reference, a script, a note). Measured 2026-11-08 over 30 days: 138 repeated signatures in 15 clusters; the top two became proposals (`r2-handoff` sections in 230 sessions, `viz` layout in 176) and `r2-pr`'s once-per-use reference read was rightly declined. Idea from EnvOpt ([itea1001/EnvOpt](https://github.com/itea1001/EnvOpt)).

**Tend memory.** `scripts/tend-memory.py` keeps the basic-memory knowledge base true, the way Anthropic's "dreaming" does ([components of agent memory](https://www.anthropic.com/research/components-of-agent-memory)): a note that is wrong from the start, or drifts, is read and trusted by every later session. Each night it checks a seventh of the notes (every note once a week; changed-since-last-check first), one `claude -p` per note with read-only tools: files and repos, `git log`, past chats through `recall`, the web. A note that checks out gets a ledger row and nothing else. A note that needs a fix, a flag, links, a merge, deletion, a move to Timeline Studio, or a CLAUDE.md promote/demote becomes ONE proposal carrying its exact diff. The prompt says what memory is for and lets the model judge salience rather than following a rubric, per the article. Notes are written only after a thumbs-up, by `write-memory.py` from `merge-approved.sh`, and only if the note is still what was checked; each is one revertible `dream(<id>)` commit in `~/basic-memory`. Formats: `CONTRACTS.md` § Memory pass.

**Review.** The `dream-queue` viz lists every proposal ranked by recurrence × blast radius, renders each branch's diff (a memory proposal's diff is in its plan file), keeps memory proposals under their own **memory** filter, and badges conflicts detected with `git merge-tree --write-tree`. After each night, `scripts/notify.sh` DMs Joseph on Discord through retinue's herald when proposals are waiting (or the night failed), with the queue link.

**Apply.** `scripts/merge-approved.sh` writes approved notes into `~/basic-memory`, then squash-merges approved branches into `private/trunk` serially, in approval order.

## Running it

```bash
scripts/nightly.sh                       # the full pipeline (what launchd calls)
scripts/scan.py --dry-run                # what stage 1 would funnel
scripts/scan.py --backfill --since 2026-06-01   # historical replay, on demand
scripts/scan.py --subagents              # also mine <session>/subagents/** (assistant-side only)
scripts/score.py --dry-run               # how many moments are waiting on the judge
scripts/score.py --jobs 6                # judge them (resumable; re-runs are free)
scripts/synthesize.py --min-occurrences 3 --dry-run   # proposals, printed not written
# learn from ONE session now (e.g. the current one), at any age, singletons included:
scripts/scan.py --session <id> && scripts/score.py --session <id> && scripts/cluster.py \
  && scripts/synthesize.py --session <id>
scripts/lookups.py --dry-run             # lookups repeated in 3+ sessions, with session counts
scripts/tend-memory.py --dry-run --limit 3   # check 3 notes, print proposals, write nothing
scripts/tend-memory.py --note 'tools/x.md'   # check one note now (repeatable)
scripts/merge-approved.sh                # merge what you approved in the viz
```

Backfill is deliberately manual. Steady state starts from zero because a proposal mined
from a 4-month-old session is advice about a setup that no longer exists.

## Proposals are free-form on purpose

The envelope (`state/proposals/<id>.json`) carries only what the dashboard needs to render
and sort: title, rationale, evidence, occurrences, blast radius, rank, branch, conflicts.

**The branch carries the change.** There is no `type` enum and no taxonomy, because a single
proposal may legitimately edit a memory *and* rewrite a skill *and* install a third-party
skill from GitHub. The predecessor system used a free-text `Type` field and it drifted into
six spellings of "memory note" — a taxonomy that drifts is worse than no taxonomy.

There is **no cap** on proposals per night. The list is ranked, never truncated; unactioned
proposals carry forward and re-rank.

## Non-negotiables

1. **Never touch `main`.** It is a publish artifact — `squash-to-main.sh` force-pushes a
   single `commit-tree` snapshot to it. All work targets `private/trunk`. Publishing to the
   public repo stays a deliberate human act.
2. **Nothing auto-applies.** Every change reaches `private/trunk`, and every note edit reaches `~/basic-memory`, only through an explicit thumbs-up (decided 2026-11-08, over a tiered auto-apply). This is why there is no self-modification fence — a proposal that rewrites this skill is just another branch you review.
3. **Four stages leave the machine, and only four: `score.py`, `synthesize.py`, `tend-memory.py`** (note text, plus whatever it reads while checking, and web searches) **and `apply-proposals.sh`** (which sends only a proposal's own change.md, not transcripts). Transcripts contain client work, so this is a real cost — but the A/B in `eval/RESULTS.md` measured local synthesis at 4.5–6.0/12 against Claude's 11.1–11.8/12, and 4.5/12 is not "slightly worse": `qwen3-coder:30b` proposed hook interception in the prose-only `ponytail` skill in 6 of 11 proposals, invented `~/Desktop/Code`, and never once declined. Everything else is local: `prefilter.py` needs no model at all, and `cluster.py` embeds with `nomic-embed-text` on Ollama. **Local clustering is not an egress saving** — RESULTS.md tested the "local embeddings, Claude synthesis" hybrid and found it saves *zero* bytes, because synthesis sends the same candidate text either way. Clustering is local because embeddings are cheap and instant, not because it protects anything.
4. `~/.claude/projects` is read-only input. Never write to it, never delete from it.
5. Use `/usr/bin/find`, not `find` — the shell wrapper rejects compound predicates and exits 0
   on failure, so failures look like successes.

## See also

- `CONTRACTS.md` — frozen data formats. Change these only deliberately.
- `eval/RESULTS.md` — the local-vs-Claude A/B behind the model choices.
- `ai-setup-audit` — the other producer of proposals, working from setup state rather than
  session history. Same branch-and-review flow.
