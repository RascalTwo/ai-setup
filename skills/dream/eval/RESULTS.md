# Can local Ollama be trusted with dream's proposal synthesis?

**No. Not at either size tested, and not with the embedding model either.**

Run date 2026-08-15. Harness `ab-compare.py`, fixtures `fixtures/candidates.jsonl`,
raw outputs under `runs/`. Every number below came from a run in this directory.

---

## Recommendation

**Synthesis must go to Claude. Clustering should also go to Claude. There is no
egress-saving hybrid available, because the hybrid does not save egress.**

The single most important finding is not in the score table. It is this:

> The proposed hybrid — local embeddings for clustering, Claude for synthesis — was
> the whole reason to like local. **It saves zero egress.** Clustering is done on the
> candidate-moment text, and synthesis is done on *the same text*. Whichever component
> clusters, the moments themselves still leave the laptop for synthesis. Moving only
> the clustering on-device reduces the bytes sent by nothing.

So the decision is not a three-way choice. It is binary:

| | egress | synthesis quality (blind, /12) | nightly cost |
|---|---|---|---|
| **All local** | zero | **4.5 – 6.0** | $0 |
| **All Claude** | full candidate text leaves | **11.1 – 11.8** | ~$0.45 – 0.70 |

And local at 4.5–6.0/12 is not "slightly worse." It fails in ways that make the output
actively harmful to act on — see *How local fails*, below. A nightly job that proposes
edits to a skill which is structurally incapable of doing what the proposal claims, and
that proposes global rules for one-off noise, costs the user more review time than it saves.

### What I would actually ship

1. **Claude for clustering and synthesis.** ~$0.45–0.70/night at this fixture size
   (11 clusters, 32 moments). `claude-sonnet` is the better buy: 11.09 vs 11.82 out of 12
   for a third less cost, and it clustered *better* than opus on average (0.877 vs 0.825 ARI).
2. **Keep the extraction and prefilter local**, as CONTRACTS.md already specifies. That is
   deterministic, needs no model, and is where the volume is.
3. **Add a local egress gate before synthesis** — see *The one thing local was good at*.
   This is the only mechanism in this evaluation that actually reduces egress, and it needs
   more evidence before it is trusted.

### The egress tradeoff, stated plainly

Zero egress was the reason local was preferred, and the transcripts contain ClientB, Source
Allies, IdPProductB and IdPProductA client work. Going to Claude means **verbatim candidate-moment
excerpts — user corrections, error text, file paths, repo and client names — leave the
laptop every night.** In these fixtures alone that includes org names, internal repo names,
an internal GraphQL endpoint, and internal product names.

That is a real cost and this evaluation does not make it go away. It only establishes that
the alternative does not work. **If zero egress is genuinely non-negotiable, the honest
conclusion is that dream cannot do automated proposal synthesis at all — not that it should
do it locally.** A local nightly job producing 4.5/12 proposals is worse than no job.

Note that running this evaluation itself sent the fixtures to Claude. The fixtures were
hand-written and scrubbed of credentials for exactly that reason.

---

## Scores

### Synthesis — blind-scored, mean per proposal, 11 clusters each

| arm | root-cause depth | actionability | correctness | scope calibration | **total /12** |
|---|---|---|---|---|---|
| `claude-opus` | 3.00 | 3.00 | 2.82 | 3.00 | **11.82** |
| `claude-sonnet` | 3.00 | 2.64 | 2.55 | 2.91 | **11.09** |
| `qwen2.5-coder:14b` | 0.82 | 1.36 | 1.64 | 2.18 | **6.00** |
| `qwen3-coder:30b` | 1.18 | 1.27 | 0.91 | 1.09 | **4.45** |

Per-proposal scores in `runs/main/scores.json`, arm mapping in `runs/main/blind-key.json`.

<details>
<summary><b>The rubric</b> — four dimensions, 0–3 each, written before any output was read</summary>

Why four and not one: a nightly proposal is worthless in four independent ways. It can be
shallow (restates the symptom), unapplyable (vague), wrong (cites things that do not exist),
or disproportionate (a global rule for a one-off). A single "quality" number lets a
fluent-but-hallucinating arm hide behind prose.

**1. root_cause_depth — fixes the class, or restates the symptom?**
- 0 — restates the symptom as an instruction, with no account of why the identical
  instruction already in the rules file was ignored
- 1 — names a plausible cause, but the fix still targets the symptom
- 2 — identifies the actual mechanism (stale in-context copy; a prose rule with no
  enforcement point; unbounded search whose partial output reads as a negative result)
  and targets it
- 3 — as 2, plus surfaces something the moments only imply: that the wrapper's **exit 0**
  is what makes it dangerous rather than annoying, or that the timeout cluster manufactures
  the "it doesn't exist" cluster

**2. actionability — applyable tonight without a follow-up question?**
- 0 — advice with no target
- 1 — names a target, describes the change abstractly
- 2 — real target, concrete change, implementable without asking anything
- 3 — as 2, at the level of the mechanism: hook event *and* matcher, literal rule text,
  specific skill file — effectively a diff

**3. correctness — grounded in things that exist** (fed by the automated `check` pass,
then hand-adjudicated for claims a regex cannot check)
- 0 — **hard fail.** Any hallucinated path or invented skill name. A proposal that edits a
  file which does not exist is worse than no proposal
- 1 — no hallucination, but a factual error about the setup (wrong section, a hook event
  that does not exist, a mechanism that cannot do what is claimed)
- 2 — everything referenced exists and is used correctly
- 3 — as 2, and uses a real inventory detail a guesser would not produce

**4. scope_calibration — right blast radius, and restraint**
- 0 — a global rule for a one-off, **or** any proposal at all for a trap group
- 1 — blast radius one notch wrong in either direction
- 2 — correct blast radius, justified by the evidence present
- 3 — correct, and explicitly reasons about it (cites occurrences across N sessions, or
  declines and says why)

Expected: G1–G9 are `global` (G4 also acceptable as `single-skill`, being one MCP server's
usage pattern). `SINGLE-repo-merge-policy` should be `null` or at most `project`.
`SINGLE-ping-demo-tab` should be `null`. Because nine of eleven groups are `global`, this
dimension's discriminating power sits almost entirely in the two traps — deliberately, since
restraint is the failure mode that matters most in an unsupervised job.

</details>

**The bigger local model is the worse one.** `qwen3-coder:30b` scored below the 14B on
three of four dimensions and took 1.9× as long. Do not assume the 30B is the safe default
because it is larger.

### Clustering — Adjusted Rand Index against hand-labelled gold, 3 trials

| arm | trial 1 | trial 2 | trial 3 | mean | k | wall | cost |
|---|---|---|---|---|---|---|---|
| `claude-sonnet` | 0.905 | 0.939 | 0.787 | **0.877** | 11–13 | ~31s | ~$0.06 |
| `claude-opus` | 0.734 | 0.803 | 0.939 | **0.825** | 11–12 | ~34s | ~$0.08 |
| local `nomic-embed-text` + agglomerative | 0.576 | 0.576 | 0.576 | **0.576** | 15 | ~1s | $0 |

The local figure is **oracle-tuned and therefore optimistic.** It is the best cell of a
12-configuration sweep (3 text encodings × 4 linkage methods) with the distance threshold
chosen by maximising ARI *against the gold labels*. A nightly run has no gold labels, so it
cannot pick that threshold. The realistic untuned number is **0.504**. The full grid is in
`runs/main/clustering.json`; nothing in it beat 0.576.

Claude's clustering "errors" are mostly not errors. Opus merged the edit-without-read and
stale-browser-ref groups into one cluster it named `acting-on-stale-or-unread-state`, which
is arguably a better root cause than my gold labels. Sonnet split the skill-first group into
`skill-not-actually-read` and `reinvents-existing-tool` — a distinction I had flagged in the
fixture's own notes. ARI understates both.

---

## How local fails

The score gap is not a matter of polish. Each local arm has one systematic, mechanically
verifiable defect.

### `qwen3-coder:30b` — proposes changes to a skill that cannot do what it claims

Six of its eleven proposals target the `ponytail` skill:

```
targets = {'ponytail': 6, 'CLAUDE.md': 2, '~/.claude/settings.json': 1,
           'ask-matt': 1, 'delegate-to-codex': 1}
```

`ponytail` is a prose skill about writing the laziest code that works. `grep -ri "hook\|PreToolUse"`
over its directory returns nothing. It has no interception mechanism of any kind. The 30B
proposed, among others, "Modify the ponytail skill to automatically re-read a file if it has
been previously read and is about to be edited" and "Modify the ponytail skill to include a
check in its pre-processing step" — skills have no pre-processing step. It also routed a
credential-leak fix to `ask-matt` (a skill router) and a PR-merge fix to `delegate-to-codex`
(an OpenAI Codex offloader).

These pass an automated existence check, because the skill names are real. That is exactly
why the rubric scores correctness by hand as well as by regex.

It also hallucinated `~/Desktop/Code`, twice. The real tree is `~/Desktop/Desktop/Code`,
which is in the inventory it was given.

**And it never declined.** It emitted a proposal for all 11 groups, including both
deliberate one-off traps — a broken demo tab in a throwaway PoC became a `ponytail` skill
edit. In an unsupervised nightly job, that is the expensive failure: every spurious proposal
is a human review.

### `qwen2.5-coder:14b` — one mechanism, always, regardless of evidence

Nine of nine proposals were `rule-edit` on `CLAUDE.md`. It never once proposed a hook.

Most of these clusters exist *because a written rule already failed*. The find-wrapper
gotcha is in `CLAUDE.md` §9. The gh-account gotcha is in §9. The voice-ambiguity rule is §1.
The skill-first trip-wire is §5. The 14B's answer in each case was to write the rule again:

> "Add a rule that explicitly states 'Always use /usr/bin/find directly instead of any
> wrapper like rtk find.'"

That rule is already there, verbatim in spirit, and the fixture contains the user saying
*"i literally have a rule in my claude md that says use /usr/bin/find not find. thats like
the third time this week. why does writing the rule down not fix it."* The 14B read that
sentence and proposed writing the rule down.

It also produced the one clear path hallucination among the low-verbosity arms:
`~/.claude/rules_file` — it copied the *JSON key name* from the inventory and treated it as
a filesystem path.

### What both Claude arms did instead

Nine of nine `hook` proposals from opus, seven of nine from sonnet, each naming the hook
event, the matcher, and the script behaviour. Both correctly returned `{"proposal": null}`
for **both** trap groups. Representative reasoning, opus, on the PoC demo-tab trap:

> "A single vague user question about a broken demo tab in one session, with no visible
> agent misbehavior or diagnosable pattern, is too thin to justify a setup change."

---

## The hybrid, tested rather than assumed

`ab-compare.py hybrid` feeds Claude the clusters the local embedder actually produces
(k=11), not the gold clusters. Result: **9 proposals from 11 clusters.**

| local cluster | gold root causes inside it | Claude's output |
|---|---|---|
| `local-c9` | G1 find-wrapper | correct proposal |
| `local-c10` | G2 edit-without-read | correct proposal |
| `local-c2` | G2 + **G3 secrets** + G9 | credential proposal only — G2/G9 signal dropped |
| `local-c3` | G4 + **G5** + trap | negative-existence proposal only — G4 dropped |
| `local-c4` | G6 + **G7** | skill-read proposal only — G6 dropped |
| `local-c11` | G7 + G9 + trap | **NO PROPOSAL** |
| `local-c6` | G8 (split off alone) | **NO PROPOSAL** |

Net effect: **G9 (wrong gh account) is lost entirely**, and G5 gets two competing proposals
from two different clusters, which downstream would produce two conflicting branches.

Two things worth noting:

- **Claude synthesis degrades safely under bad clustering.** It dropped signal; it never
  emitted a miscalibrated global rule from a trap-contaminated cluster. Contamination costs
  recall, not correctness.
- **The hybrid cost more, not less.** $0.6395 for 11 local clusters vs $0.4017 for sonnet on
  11 gold clusters, because contaminated clusters carry more moments per call. The cheap
  component made the expensive component more expensive.

The reverse hybrid (Claude clusters, local synthesises) is dead without a run: local
synthesis scored 4.5–6.0/12 on *gold* clusters, which is the best input it could ever get.

---

## Wall clock, tokens, cost

Synthesis, 11 clusters, model resident, measured in `runs/main/synth.log`:

| arm | total wall | median/cluster | in-tok | out-tok | cost |
|---|---|---|---|---|---|
| `qwen2.5-coder:14b` | 153.0s | 14.4s | 18,198 | 1,471 | $0 |
| `claude-sonnet` | 219.9s | 17.4s | 29,256 | 17,483 | $0.4017 |
| `claude-opus` | 229.5s | 20.8s | 29,256 | 15,116 | $0.5921 |
| `qwen3-coder:30b` | 291.2s | 29.7s | 17,967 | 2,289 | $0 |

Local is not meaningfully faster. The 30B is the **slowest** arm of the four.

Claude's input token count is higher for identical prompts because the CLI adds a small
harness system prompt; both Claude arms saw byte-identical user prompts. Output tokens are
7–12× the local arms' — Claude wrote far more per proposal, which is most of the
actionability gap and is also the main leak in the blinding (see below).

**Parse reliability was a non-issue: 0 failures out of 44 calls, all four arms.** JSON output
was not forced. Local models produce well-formed JSON here; that is not where they fail.

### Two operational costs the harness only found by hitting them

- **Model load: 43s for `qwen3-coder:30b` (20.1 GB VRAM).** Paid once per arm per night.
- **Do not interleave two local models.** The first synthesis run iterated group-outer,
  arm-inner, so Ollama evicted and reloaded ~20 GB on every call. It ran **over 25 minutes
  without finishing 11 clusters**. Re-ordered to arm-outer, the same 30B work took **291
  seconds**. The harness now does arm-outer and says why in a comment. One observed
  `qwen2.5-coder:14b` "model load" of 974s is an artifact of that interrupted run (an
  orphaned 30B generation had to drain before eviction) and should not be read as a real
  load time.
- **Ollama serialises.** A `nomic-embed-text` embedding call issued while the 30B was
  generating blocked past a 2-minute timeout. Clustering and synthesis cannot overlap on
  one Ollama instance.

---

## Method, and what is wrong with it

### Fixtures

32 candidate moments, 11 gold root causes, 11 sessions, 7 projects — `fixtures/candidates.jsonl`.
Every row carries the full `CONTRACTS.md` candidate schema, plus two eval-only fields
(`gold_cluster`, `gold_note`) that are stripped from every prompt.

Nine root causes repeat across sessions (2–4 moments each) so clustering has real structure
to find. Two are deliberate singleton traps — a repo-specific branch-protection error and a
UI bug in a throwaway PoC — that should produce **no proposal at all**. Both traps are where
scope calibration is actually measured.

Grounding: five real transcripts were mined from `~/.claude/projects/` and the moments were
written from what was actually there — the `rtk find` wrapper message, `String to replace not
found in file`, `ref_65` staleness, `Exit code 143 Command timed out after 2m 0s`,
`(eval):cd:1: no such file or directory`, the user's own *"Dang it, I meant Ragflow this
entire time"* and *"no its already downloadd, look in ~/Downloads"*. Two clusters
(find-wrapper, gh-account) target gotchas already written into `CLAUDE.md` §9, so the
fixtures can distinguish an arm that restates an existing rule from one that notices the
rule already failed. Live credentials seen in the real transcripts were **not** reproduced;
those fixtures carry `[REDACTED-IN-FIXTURE]`.

### Fairness controls

- Every arm received byte-identical prompts, including a machine-generated inventory of the
  real setup (88 skill names, the 12 real `CLAUDE.md` section headings, real paths).
- Claude was run with `--setting-sources '' --strict-mcp-config --tools ''`. Without this the
  reference arm silently inherits ~19k tokens of the user's own CLAUDE.md and skill index —
  context the local arms never get — and the comparison is meaningless.
- Synthesis was scored on **gold** clusters for all arms, so clustering quality cannot leak
  into synthesis scores. The hybrid arm is the separate, deliberate exception.
- Local clustering was given a 12-configuration sweep and oracle threshold selection; the
  Claude arms got one zero-shot attempt each.

### The blinding is imperfect, and here is exactly how

**I scored the packet, and I am one of the arms.** That is a real conflict. Mitigations:
the rubric was written before any output was read; arm labels were shuffled per group by a
hash of the group id, so `#A` is a different model in every group; and the correctness
dimension is backed by an automated existence check that never sees the arm label.

The mitigation that did not hold: **output length gives the arms away.** Claude wrote 7–12×
more tokens per proposal. Anyone reading the packet can guess which arm is which.

The reason I still believe the ranking is that the decisive deductions are checkable facts,
not taste:

- `~/Desktop/Code` does not exist — verified with `ls`.
- `ponytail` contains no hook or tool-interception mechanism — verified with `grep`.
- `ask-matt` is a skill router; `delegate-to-codex` offloads work to Codex — verified from
  their `description:` frontmatter.
- The `/usr/bin/find` and `gh auth switch` rules are already in `CLAUDE.md` §9 — verified by
  reading it.

Anyone can re-run those four checks and get the same answer. **A skeptical reader who
distrusts my qualitative scores should look at the mechanism distribution instead**
(`ponytail`×6 vs `hook`×9), which needs no judgement at all and tells the same story.

### Automated correctness check, adjudicated

`ab-compare.py check` flags every path and skill name that does not resolve on disk. Raw
counts mislead and must be adjudicated, which is why the tool emits the mechanism and the
surrounding sentence with each hit:

| arm | flagged | regex false positives | legitimate new files | **real hallucinations** |
|---|---|---|---|---|
| `claude-opus` | 16/32 | 11 | 5 (hook scripts it creates) | **0** |
| `claude-sonnet` | 6/20 | 6 | 0 | **0** |
| `qwen2.5-coder:14b` | 1/10 | 0 | 0 | **1** (`~/.claude/rules_file`) |
| `qwen3-coder:30b` | 4/7 | 2 | 0 | **2** (`~/Desktop/Code`, ×2) |

The false positives are slash-containing regexes and prose (`/Write/Edit`, `.py/.js/.ts/.sh`)
that the path extractor mistakes for paths. Claude's high raw count is a verbosity artifact:
it names 32 concrete paths where the 30B names 7.

Note this check is **blind to the 30B's actual worst failure** — targeting real skills that
cannot do the job. Automated existence checking is necessary and nowhere near sufficient.

---

## What would change the recommendation

- **A local model that proposes mechanisms, not prose.** The gap is not fluency; all four
  arms wrote clean JSON. It is that neither local model reached for a hook. A local model
  that produces a correct `PreToolUse` spec would close most of the gap. Worth re-testing
  when a new local coder model lands — the harness re-runs with one line in `SYNTH_ARMS`.
- **A redaction layer.** If candidate text could be reliably stripped of client identifiers
  before synthesis, all-Claude stops being an egress decision. That is a separate build, and
  it should be evaluated as adversarially as this was.
- **A bigger trap set.** Scope calibration rests on only 2 of 11 groups. That is the
  dimension I would most want more evidence on before betting on it.
- **Gold labels are mine.** I wrote both the fixtures and the gold clusters. Claude arms
  agreeing with gold at ARI 0.83–0.88 partly measures agreement with the labeller. The
  synthesis scores do not depend on gold labels; the clustering scores do.
- **Real candidates, not fixtures.** These moments are hand-written from real material, not
  extracted by the actual capture layer. Re-run against the first real night's output before
  treating the numbers as final.

### The one thing local was good at

`qwen2.5-coder:14b` correctly declined **both** trap groups, scoring 11/12 on each — its two
best results by a wide margin. It cannot write a proposal, but on this evidence it can tell
that a cluster is not worth writing one about.

That suggests the only hybrid in this evaluation that would actually reduce egress:
**a local triage gate that decides which clusters get escalated to Claude at all**, with the
un-escalated ones never leaving the machine. It is cheap, it fits the existing architecture,
and it attacks the real constraint rather than the imagined one.

It rests on **n=2**. Do not ship it on this evidence. Build a fixture set of 20–30 clusters
that are deliberately not worth proposing, and measure the 14B's decline rate and false-
decline rate against Claude's before trusting it with the gate.

---

## Reproducing

```sh
cd skills/dream/eval
RUN_DIR=$PWD/runs/main python3 ab-compare.py cluster   # ~90s,  ~$0.15
RUN_DIR=$PWD/runs/main python3 ab-compare.py synth     # ~16min, ~$1.00  (resumable)
python3 ab-compare.py check  runs/main                 # objective correctness
python3 ab-compare.py blind  runs/main                 # scoring packet + key
# score blind into runs/main/scores.json, then:
python3 ab-compare.py score  runs/main
python3 ab-compare.py hybrid runs/main                 # ~7min,  ~$0.64
```

`synth` checkpoints per arm to `synth.partial.json` and resumes, because a 20 GB local arm
takes minutes and the run does get interrupted.
