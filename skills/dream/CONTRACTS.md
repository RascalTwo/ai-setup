# dream — build contracts

Frozen interfaces every component builds against. **Do not change a format here without
saying so explicitly in your report** — six components are being built in parallel against it.

## Repo facts (verified, do not re-derive)

- Repo root: `~/Desktop/Desktop/Code/ai-setup` (referred to below as `$REPO`)
- Skill root: `$REPO/skills/dream` (`$SKILL`)
- **Development branch is `private/trunk`. NOT `main`.**
- `main` is a *publish artifact*: `squash-to-main.sh` builds one snapshot commit with
  `git commit-tree` from `private/trunk`'s tree and force-pushes. It has no history.
- **Nothing in this system may touch `main`, push to `origin`, or run `squash-to-main.sh`.**
  Publishing stays a deliberate human act.
- git 2.52.0 — `git merge-tree --write-tree` is available and verified working.
- Live skills are symlinked from `~/.agents/skills/<name>` → `$REPO/skills/<name>`.

## Transcript facts (verified, do not re-derive)

- Transcripts: `~/.claude/projects/<project-slug>/<session-id>.jsonl` — **3,813 real sessions**
  (3,608 MB). Total file count including subagents is 7,844.
- **Subagent transcripts are segregated by PATH, not by field.** They live at
  `projects/<slug>/<session>/subagents/*.jsonl` and deeper `workflows/` paths — 4,054 files,
  1,029 MB (2026-08-16). The `*/*.jsonl` glob excludes all of them; zero top-level sessions
  carry `isSidechain: true`. Keep a head-probe for `isSidechain` as defence-in-depth
  (0.9 s corpus-wide).
  **Anyone enumerating with a bare recursive `-name '*.jsonl'` will pull in 1 GB of subagent noise.**
  They are read only when `scan.py --subagents` is passed — see *Subagent capture* below.
- Size: p50 856 KB, p90 8.1 MB, **max 54 MB**. Never load a whole transcript into a model.
- **Measured (2026-08-15, recall-first stage 1): compresses 52.6x** — 3,606 MB → 68.6 MB,
  **57,490 stage-1 moments** over 2,805 sessions, **19.3 seconds** for the whole corpus, 27 MB
  RSS. (The previous keyword prefilter compressed 318x to 8,385 moments and was measured at
  20–64% recall; the extra 49,000 moments are the funnel doing its job.) Stage 1 is still
  effectively free. Stage 2 is not — see below.
- **Stage-2 backfill is the expensive one.** 57,490 moments ÷ 25 per call ≈ 2,300 `claude -p`
  calls. Measured on the 96-session audit set: ~40 moments/minute at `--jobs 6` on `sonnet`.
  Budget hours, not minutes, for a full backfill. **Use `sonnet` (the default), not haiku** —
  measured 142/142 batches at 21–25 s/batch, ~$7.70 for 42 sessions. An earlier version of
  this file recommended haiku; that was wrong. Haiku's extended thinking consumed the turn
  budget and failed ~2/3 of batches, and it was *slower* per batch (110–170 s). Fixed by
  `--max-turns 2`, but sonnet remains the verified configuration.
  A nightly incremental run is 10–30 sessions ≈ 200–600 moments ≈ single-digit minutes.
- Only ~40% of bytes are messages; the rest is `file-history-snapshot`, `mode`,
  `permission-mode`, `last-prompt`, `attachment`, `ai-title`, `system` line types.
- Each line is a JSON object. Relevant fields: `type`, `uuid`, `sessionId`, `isSidechain`,
  `isMeta`, `timestamp`, `message.role`, `message.content`.

## Signal definition — TWO STAGES (revised 2026-08-15 after the recall audit)

Selection is a funnel, not a single decision. Stage 1 is deterministic and narrows;
stage 2 is a model and judges. **Do not put judgment in stage 1** — six independent
auditors measured the single-stage keyword version at 20–64% recall, and ~60 of 91
misses were unreachable by *any* pattern list.

**Stage 1 — `scripts/prefilter.py`, deterministic, no model. Output: `state/stage1/`.**

1. **Type filter** — keep only lines where `type` is `"user"` or `"assistant"`.
2. **Substance gate** — a user turn counts only if `isMeta` is not true AND its text is
   **≥ 3 words**. ("ok", "yes", "go", "sure" are not signal.)
3. **Watermark** — incremental by message `uuid`, never by timestamp. Resumable mid-session.
4. **Machine-driven sessions are dropped whole.** `entrypoint` ∈ `sdk-cli`/`sdk-ts`, or
   `promptSource == "sdk"`, means a program drove the session — including this pipeline's
   own `claude -p` calls. Verified over a 400-session sample: every human session is
   `typed`/absent, every SDK session is `sdk`. This is the primary self-ingestion guard and
   it does not depend on prompt wording.
5. **Prompt-fingerprint guard.** Any turn sharing ≥ 3 eight-word runs with a long string
   literal in this skill's own source is dropped. The fingerprint is derived from the
   source at run time, so editing a prompt updates it. Backstop for transcripts predating
   the fields in (4). **Its blast radius includes docstrings and comments**: the fingerprint
   is every long string literal in `scripts/`, `hooks/` and `eval/`, so quoting a transcript
   verbatim while documenting a fix blacklists the turn it came from. Hit for real on
   2026-08-16 — a docstring reproducing ~25 words of a dictated turn silently deleted that
   turn, which was a gold moment, from the funnel. Paraphrase real turns; never paste them.
6. **Every substantive human turn is admitted.** No keyword gate — the previous one
   correlated monotonically with turn length (<20 words 0%, 200+ 79%) and dropped every
   short blunt objection. Stage-1 recall on human turns must stay length-independent.
7. **Assistant turns are first-class.** A segment is admitted when a first-person subject is
   followed within one sentence by a past-tense verb — the grammatical shape of a
   self-retraction, an admitted error, an abandoned hypothesis, or a disclosed mutation of
   the user's state. A closed grammatical class, not a topic vocabulary.
8. **Turns are split into segments at SENTENCE boundaries**, each emitted as its own moment.
   This user dictates 300-word turns holding 6–10 separate decisions; one boolean per turn
   extracts at most one. **Granularity is measured, not chosen** (2026-08-16): human text
   packs sentences to a 15-word *minimum* and a 40-word hard cap, because 10 of the 12 gold
   moments the judge discarded were a 4–10 word objection inside a 28–59 word segment that
   was otherwise briefing or praise. Assistant prose keeps a 60-word max-packed window — the
   `SELF_REPORT` gate needs the trigger and the admission it introduces in the same unit, and
   cutting assistant text finer cost 11 points of assistant stage-1 recall for 2.4× the
   moments. Cost of the split: stage-1 moments ×1.45 on the gold set.
9. **A non-zero exit is not an error.** A `tool_result` becomes a moment only when what
   remains after its `Exit code N` header carries error semantics, and known
   intent-verification probes (`no upstream configured`, `nothing to commit`, no-match
   greps) are excluded. Denials and interruptions are always kept.
   **Exception — dispatch reports.** A *successful* `Task`/`Agent` result is the report a
   subagent hands back, not a probe. It is segmented and gated exactly like assistant
   prose (`ASSISTANT_WINDOW_WORDS` + `SELF_REPORT`) and carries an `agent_id`. See
   *Dispatch reports* below — the yield is near zero while `--subagents` is on, and the
   path exists as a fallback for when it is not.
10. **Truncation keeps both ends.** Clipping preserves the tail; the operative constraint of
    an instruction is at the end far more often than the start.

## Subagent capture (added 2026-08-16, OPT-IN)

`scan.py --subagents` additionally funnels `<slug>/<session>/subagents/**/*.jsonl`.
Off by default. Five rules, each one measured, not assumed:

1. **There is no human in a subagent transcript.** The `user` turn is a dispatch prompt
   written by another agent, so *every* user-side category (correction, frustration, stated
   preference) is meaningless or actively misleading. Human turns are read as **context only**
   and never emitted. Measured: suppressing them drops **~21,500 would-be "human signal"
   moments** — 2.5× the entire assistant yield — including briefs like *"verify EVERYTHING
   with live sources"* that read exactly like a stated user preference. Stage 1 emits
   `role` ∈ `assistant`/`tool` from these files and **never** `user`.
2. **Guard A must be INHERITED from the parent.** A subagent's own lines say
   `entrypoint: cli` (3,034) or carry no entrypoint (979), and `promptSource` is set on
   **zero** of 4,054 files. The SDK marker exists only in the parent transcript, so
   `prefilter.is_machine_driven(parent_transcript(path))` is what actually fires. Without it
   the pipeline would mine subagents it had dispatched itself.
3. **Attribution is to the PARENT session.** `session_id` on a subagent moment is the parent's
   (which is also what the file's own `sessionId` field contains), so a lesson clusters with
   the work that produced it instead of looking like an isolated one-off.
4. **The ledger needs its own key**: `<parent-session-id>/<path-relative-to-the-session-dir>`,
   e.g. `74d4bf7e-…/subagents/agent-a333cad29`. Keying on `session_id` would collide with the
   parent and with every sibling subagent; keying on the filename stem would also collide —
   7 of 659 parents reuse a stem across `workflows/` dirs (`journal.jsonl` twice).
5. **`occurrences` collapses one parent's subagents to 1** (`cluster.py:occurrences`). Mean
   fan-out is 6.2 subagents per parent and the worst parent produced **519** stage-1 moments;
   counting each as an independent occurrence would let one event outrank a problem that
   genuinely recurred for weeks. Top-level counting is unchanged.

**Stage-1 records gain an optional `agent_id`**, present *only* on subagent moments, so
top-level output stays byte-identical for every existing consumer. `score.py` passes it
through to `candidates/`; `cluster.py` reads it for rule 5.

**Not redundant with the parent — measured.** Of 547 subagent assistant moments across 80
parents, **99.6% are absent from what stage 1 captures from the parent** (8-word shingle
containment ≥ 50%), and semantically 0/175 reach cosine 0.85 against any parent-captured
moment (`nomic-embed-text`, `search_document:` prefix, median max-sim 0.759). 37.3% do appear
somewhere in the parent's raw bytes — 24.1% inside a dispatch `tool_result`. That looked like
a separate, cheaper opportunity. It is not; see below.

## Dispatch reports in the parent (rule 9's exception, measured 2026-08-16)

**The tool has two names.** `Agent` 3,010 results corpus-wide, `Task` 34. The tool was
renamed in early 2026 and the subagent-capture study only ever said "Task" — matching that
name alone finds 34 dispatches in 5,013 sessions and yields 16 moments. Match both.
718 of 3,044 results are launch metadata, not reports: an **async** dispatch returns
`Async agent launched…` (the report arrives later inside `<task-notification><result>`,
which `_STRIP` deletes) and a team spawn returns `Spawned successfully…`. Both are skipped —
they are bookkeeping and they contain imperative text addressed to the agent.

**Reading them is 99.995% redundant while `--subagents` is on, and that is measured, not
assumed.** 2,323 real reports (12.5 MB) sit in parent transcripts; 1,884 carry the harness's
`agentId:` footer, and `agent-<agentId>` is exactly the stem of that subagent's own
transcript — **1,881 of 1,884 (99.8%) are on disk**, so `--subagents` already reads them.
Sampling 59 report/transcript pairs: the report as a whole is only ~1% shingle-contained in
the subagent's stage-1 output (median 0.01, because stage 1 emits only `SELF_REPORT` segments)
but **32 of 32 of the report's own admitted moments are 100% contained** — the part that
becomes a moment is captured either way.

| configuration | stage-1 moments added | stage-2 cost | runtime |
|---|---|---|---|
| `--subagents` **on** (nightly.sh) | **282** of which 277 are text-duplicates → **5 new** | ~$0.01 | +0.3 s |
| `--subagents` **off** | 1,237 (+1.4%) | ~$2.77 | +1.2 s |

So this is a **fallback, not a gain**: it fires exactly when the primary capture path is
disabled. `scan.py` wires `skip_captured_agents` to its own `--subagents` flag, and the
suppression resolves the agent stem against the whole `<session>/subagents/` tree, not the
sibling path — a subagent can dispatch its own subagents and the grandchild is filed under
the session, not beside its dispatcher. Checking only the sibling path missed 474 of 737
already-captured reports, i.e. more than it caught.

**Guard B runs on the dispatch brief as well as the report.** A `Task`/`Agent` result is the
only place a prompt is recorded next to its output, so a subagent this pipeline dispatched is
caught by its brief even when the report paraphrases. Verified: a report reproducing
`score.py`'s instructions is rejected, and so is a clean report under a brief that reproduces
them. Zero false positives on the corpus.

**`(uuid, seq)` must be unique per message, including on the tool side.** Parallel dispatches
return as several `tool_result` blocks under one uuid; the old fixed `seq = 0` made them
collide, and `cluster.py` dedupes candidates on `(session_id, uuid, seq)`. One counter now
spans every tool_result in a message. Measured: 34 messages emit ≥2 tool-side moments and
**40 moments were being silently merged away** — 8× the yield of the dispatch-report path
itself.

**Stage 2 — `scripts/score.py`, one `claude -p` call per batch. Output: `state/candidates/`.**

Judges each stage-1 moment on stance, not vocabulary: understated dissatisfaction ("i
thought", "i could've sworn", "hmm", "are you sure?") and assistant self-retraction have no
fixed vocabulary. Survivors become candidates. Model is configurable (`--model`,
`DREAM_SCORE_MODEL`); `--tools ""` is load-bearing for cost (≈700 prompt tokens instead of
≈45,000, measured).

**The judge sees `text` and nothing else. Do not pass it `context`** — measured 2026-08-16:
the same moments with their surrounding turn appended as explicitly-labelled, explicitly
not-to-be-judged context scored 15/36 against 22/36 for text alone, i.e. all the way back to
not having split the turn at all. The judge averages whatever is in front of it, so
surrounding text re-creates exactly the dilution that segmentation exists to remove.
`context` stays in the record for the human and for `synthesize.py`.

> `$DREAM_STATE` is `~/.agents/state/dream/` unless overridden. State lives outside
> the repo: it holds verbatim excerpts of client work, and this tree is published.

## `$DREAM_STATE/processed.tsv` — the ledger

Append-only, tab-separated, no header. One row per session **per successful extraction**.

```
<key>\t<iso8601-utc>\t<last-uuid-seen>\t<candidate-count>\t<writer>
```

`<key>` is the **session id** for a top-level session, and
`<parent-session-id>/<path-relative-to-the-session-dir>` for a subagent transcript
(see *Subagent capture*). A `/` in column 1 is what distinguishes the two. It is a
FILE identity, not a session identity — subagent moments are still attributed to the
parent `session_id`, and several ledger keys therefore map to one `stage1/` file.

`<writer>` ∈ `scan` | `stop-hook` | `session-end-hook`.
A session may appear multiple times (incremental). **The row with the newest timestamp wins.**
Resume logic reads the newest `<last-uuid-seen>` for a session and processes only lines after it.

## `$DREAM_STATE/stage1/<session-id>.jsonl` — the funnel

Written by `prefilter.py` (via `scan.py` and the Stop hook), appended. **Not** the pipeline's
input — `score.py` reads it and nothing else does. Recall-first: expect ~10× the rows of
`candidates/`, most of which will be judged away.

```json
{
  "session_id": "uuid", "uuid": "message-uuid-this-came-from",
  "ts": "2026-08-15T03:04:05Z", "project": "project-slug", "tool": "claude-code",
  "role": "user|assistant|tool",
  "seq": 0,
  "kind": "user|assistant|tool_error|rejection",
  "text": "verbatim excerpt or segment, max 2000 chars",
  "context": "surrounding excerpt, max 1000 chars",
  "source": "prefilter",
  "agent_id": "agent-a333cad29"
}
```

`agent_id` is **present only on subagent moments** and omitted entirely otherwise, so
top-level output is byte-identical to what it was before subagent capture existed.

`seq` is the segment index within one message — **`(uuid, seq)` is the moment key, `uuid`
alone is not unique.** Stage-1 `kind` is mechanical: it records *where* the text came from
and makes no semantic claim.

## `$DREAM_STATE/candidates/<session-id>.jsonl` — the artifact

One JSON object per line. Written by `score.py`, which **rewrites the file atomically** from
stage-1 output plus cached verdicts — it is a pure function of those two, so re-running never
duplicates rows. Tool-agnostic on purpose (Codex/Copilot slot in later).

```json
{
  "session_id": "uuid",
  "uuid": "message-uuid-this-came-from",
  "ts": "2026-08-15T03:04:05Z",
  "project": "project-slug",
  "tool": "claude-code",
  "role": "user|assistant|tool",
  "seq": 0,
  "kind": "friction|preference|tool_error|rejection",
  "text": "verbatim excerpt, max 2000 chars",
  "context": "optional short surrounding excerpt, max 1000 chars",
  "why": "one line, why the judge kept it",
  "source": "score",
  "agent_id": "agent-a333cad29"
}
```

`agent_id` is passed through from stage 1 and, as there, present only on subagent moments.
`cluster.py` uses it to keep one parent's fan-out from inflating `occurrences`.

**The `kind` enum is deliberately coarse.** The old six-way split
(`correction|frustration|preference|positive|…`) was measured wrong 8 times in 14 on a single
session — a plain task brief came back `preference`. Nothing downstream depends on fine
kinds (`cluster.py` counts them, `synthesize.py` prints them), so the taxonomy shrank to what
a judge gets right: `friction` (something went wrong), `preference` (a rule meant to outlive
the task), plus the two mechanical tool kinds passed through from stage 1.

`source: "score"` = kept by the stage-2 judge. `source: "prefilter"` in this directory is
pre-2026-08-15 output. `source: "enrichment"` was the local SessionEnd pass, now superseded.

## `$DREAM_STATE/score-cache.jsonl` — the verdict cache

Append-only. `{"h": sha256(role+kind+text), "keep": bool, "kind": "...", "why": "..."}`.
Keyed by **content, not position**, so re-running stage 1 (which renumbers `seq`) does not
throw the cache away. This is the whole of `score.py`'s resumability: an interrupted run
loses at most one batch, and a re-run costs nothing for moments already judged.

## `$DREAM_STATE/proposals/<proposal-id>.json` — the envelope

**The envelope is thin on purpose. The branch carries the change.** No `type` enum, no
taxonomy — a proposal may edit a memory, rewrite a skill, install a third-party skill,
or all three at once.

```json
{
  "id": "20260815-0001",
  "title": "one line, imperative",
  "rationale": "why this is worth doing, prose, no length limit",
  "evidence": ["session-id", "session-id"],
  "occurrences": 7,
  "blast_radius": "global|project|single-skill",
  "rank": 0.0,
  "branch": "dream/20260815-0001-short-slug",
  "conflicts_with": ["20260815-0004"],
  "status": "pending|approved|denied|merged|stale",
  "stale_reason": "rival-merged|trunk-diverged",
  "created": "2026-08-15T03:04:05Z",
  "approved_at": "2026-08-15T08:12:00Z"
}
```

- **`approved_at` is REQUIRED when the viz sets `status: "approved"`.** Merge order is
  approval order, and there is no other record of it. Do not rely on file mtime —
  `detect-conflicts.sh` rewrites envelopes and would corrupt it.
- `stale_reason` is written by `merge-approved.sh`, not the viz.

- `rank` = `occurrences × blast_radius_weight`. Weights: global 3.0, project 1.5, single-skill 1.0.
  `occurrences` counts **independent events, not members** (`cluster.py:occurrences`). Two
  collapses, both measured:
  - one parent session's subagent members → 1 (see *Subagent capture* rule 5)
  - **all segments of one source message → 1**, keyed on `(session_id, uuid)`. Stage 1 splits
    a dictated turn into ~15-word segments, so 35% of source turns now yield more than one
    kept candidate and the worst yields 14. Measured 2026-08-16: without this collapse **43%
    of all occurrence counts were inflation**, worst session 2.93×. Leaving it out re-creates
    the verbosity bias the capture rewrite removed — in the ranking instead of the capture,
    where it is harder to see. A turn whose objections land in *different* clusters still
    counts once in each; those are different findings.
- **No cap on proposal count.** Ranked, never truncated. Unactioned proposals carry forward.
- `conflicts_with` is computed with `git merge-tree --write-tree`, not guessed.

## `$DREAM_STATE/last-dream.json` — the heartbeat

Written by `nightly.sh` on **every** run including failures. Read by the viz.

```json
{
  "ts": "2026-08-15T20:56:11Z",
  "status": "ok|partial|failed",
  "last_success": "2026-08-14T03:07:00Z",
  "duration_s": 242,
  "counts": { "candidates": 386, "clusters": 41, "proposals": 12 },
  "steps": [ { "name": "cluster.py", "status": "failed", "exit": 1, "duration_s": 240 } ],
  "error": "cluster.py exited 1",
  "host": "…", "pid": 27164
}
```

**`ts` and `last_success` are separate fields and MUST NOT be collapsed.** `ts` = this run
happened. `last_success` = the pipeline last produced proposals end-to-end. Staleness is
measured against `last_success`, never `ts`.

Rationale, learned the hard way: a heartbeat that reports only "a run happened" shows
"✓ last dream: today" forever while producing zero proposals every night — which is exactly
the silent rot that killed the predecessor system, re-created inside the rot detector.

`last_success` must be **carried forward** from the previous heartbeat on a failed run, never
reset to null. A never-succeeded pipeline renders as `⛔ NEVER SUCCEEDED`.

## Git conventions

- Branch names: `dream/<proposal-id>-<short-slug>`
- **Base and merge target: `private/trunk`.**
- Approved proposals squash-merge into `private/trunk` serially, in approval order.
- A proposal that conflicts after an earlier merge is dropped (`status: "stale"`) and
  re-derived on the next run. No rebase loops, no merge queue daemon.
- Denied proposals: delete the branch, keep the JSON with `status: "denied"` so the
  dream does not re-propose the same thing forever.

## Model access — what runs where

**Local, Ollama at `http://localhost:11434`:**

| model | use |
|---|---|
| `nomic-embed-text:latest` | embeddings for `cluster.py` — **clustering is math, not an LLM call** |

`qwen3-coder:30b` and `qwen2.5-coder:14b` were the synthesis models until 2026-08-16. They
are no longer used by any stage. Kept installed only as A/B baselines for `eval/`.

**Claude, headless (`claude -p`): `score.py` (stage 2) and `synthesize.py`.** Both are
deliberate, eval-driven reversals of the original zero-egress absolute — not oversights.

- **`score.py`** sends stage-1 moment text, clipped to 700 chars each. Local scored
  4.5–6.0/12 against Claude's 11.1–11.8/12, and with the local model the capture layer does
  not work at all.
- **`synthesize.py`** sends clustered candidate text (600 chars × `--max-members` per
  cluster) plus the setup inventory. Same A/B, same task, blind-scored: `claude-opus`
  11.82/12, `claude-sonnet` 11.09/12, `qwen2.5-coder:14b` 6.00/12, `qwen3-coder:30b`
  4.45/12. The gap is not polish — the 30B targeted the prose-only `ponytail` skill for hook
  interception in 6 of 11 proposals, invented `~/Desktop/Code` twice, and **never declined**,
  emitting a proposal for both deliberate one-off traps. In an unsupervised nightly job every
  spurious proposal is a human review.

**Moving clustering on-device saves ZERO egress, and this was tested rather than assumed.**
Clustering and synthesis operate on the *same* candidate text, so whichever component
clusters, the moments still leave the laptop for synthesis. `cluster.py` is local because
embeddings are instant and free, not because they protect anything. If zero egress is
genuinely non-negotiable the honest conclusion — RESULTS.md's own — is that dream cannot do
automated synthesis at all, not that it should do it locally.

**Both stages are swappable** via `--model` and `DREAM_SCORE_MODEL` / `DREAM_SYNTH_MODEL`.
Default `sonnet` for both.

### Measured cost and runtime — synthesis, 2026-08-16, live clusters

9 uncontended calls on `sonnet` against the real `clusters.json` (1,150 clusters from 1,976
candidates). Measure this uncontended: runs overlapping another `claude -p` job showed
58–75 s/cluster purely from contention.

| | value |
|---|---|
| per cluster, wall | **48 s** (range 41–75) |
| per cluster, cost | **$0.127** |
| per cluster, tokens | ~12,000 in / ~3,300 out |
| **118 clusters (`--min-occurrences 3`)** | **~94 min, ~$15** |
| 18 clusters (`--min-occurrences 5`) | ~14 min, ~$2.30 |
| 393 clusters (`--min-occurrences 2`, the CLI default) | ~5.2 h, **~$50** |

The prior local figure was ~30 s/cluster on `qwen3-coder:30b` — **Claude is not meaningfully
slower**, and RESULTS.md measured the 30B as the *slowest* of all four arms once its 43 s
model load is counted. Cost is the only thing that changed, and calls are independent, so
`synthesize.py` could be parallelised the way `score.py` is if wall clock ever matters.

**Two consequences of synthesis no longer being free, both real:**

1. **`--min-occurrences` is now a budget dial, not just a noise filter.** The default of 2
   means 393 clusters on the current corpus. Pick it deliberately.
2. **The 90-minute `STEP_TIMEOUT` in `nightly.sh` is now load-bearing.** At 48 s/cluster it
   caps one night at ~112 clusters (~$14) and SIGTERMs the rest. That is a survivable
   backlog, not data loss — the SIGTERM handler turns the signal into `SystemExit` so the
   `finally` still writes `proposals-index.json`, and the next night resumes from it. It
   only works because that handler exists; do not remove it.

**`synthesize.py` takes no lock of its own.** `nightly.sh` holds a PID lock, so the scheduled
path is safe, but two concurrent manual runs both read the index before either writes it and
will double-propose every cluster they share. Observed for real on 2026-08-16: two overlapping
runs produced 21 proposals for 15 clusters. Dedupe by the `> cluster:` line in each
`change.md` if it happens.

**`--max-turns` is 10 here, not `score.py`'s 2.** `--json-schema` is delivered as a tool
call, so every attempt at the structured answer costs a turn, and a proposal is a ~4,000-token
document the model sometimes re-emits. Measured on cluster c001: at 2 the run failed
`error_max_turns` on both attempts, at 4 it failed at `num_turns` 5 while 2 and 8 succeeded —
the turn count is stochastic, not a fixed cost. At 10 it was 5/5, `num_turns` 2–4. The
`score.py` lesson still holds in its own context (1 is always fatal, and the failure is
invisible: non-zero exit, EMPTY stderr, reason only in the JSON on **stdout**).

## Scheduling

- macOS `launchd`, `StartCalendarInterval`, fires ~03:0x and catches up on wake.
- **AC-power gated**: check `pmset -g ps` at entry; if on battery, exit 0 without work.
- Must be safe to run concurrently with an interactive session: take a PID lock,
  and if the lock is held by a live process, exit 0.

## Non-negotiables

1. Never `rm -rf` anything under `~/.claude/projects` — it is read-only input.
2. Never push, never touch `main`, never run `squash-to-main.sh`.
3. Never auto-apply a proposal. Every change reaches `private/trunk` only via an
   explicit human thumbs-up in the viz.
4. Use `/usr/bin/find`, not `find` (the shell wrapper rejects compound predicates and
   exits 0 on failure, which silently no-ops).
5. Scripts must be idempotent and safe to re-run.
