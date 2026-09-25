#!/usr/bin/env python3
"""dream: turn each cluster into ONE ready-to-apply proposal, using Claude headless.

Reads `state/clusters.json` (from cluster.py) and for every cluster big enough to matter
emits two files:

  state/proposals/<id>.json       the thin envelope defined in CONTRACTS.md
  state/proposals/<id>.change.md  the complete change, for the git layer to turn into a branch

The envelope is deliberately thin — no `type` field, no taxonomy. One proposal may edit a
memory file AND rewrite a skill AND install a third-party skill; the change.md carries all
of it. The bar every proposal must clear is in ROOT_CAUSE_RULES below: it names the
mechanism that made the mistake likely, not the mistake, and it is scoped to the weight of
the evidence.

WHY CLAUDE. This stage ran on local Ollama until the A/B in `eval/RESULTS.md` measured it:
blind-scored on this exact task, `claude-opus` 11.82/12 and `claude-sonnet` 11.09/12 against
`qwen2.5-coder:14b` 6.00/12 and `qwen3-coder:30b` 4.45/12. The gap is not polish. The 30B
targeted the prose-only `ponytail` skill for hook interception in 6 of 11 proposals,
hallucinated `~/Desktop/Code` twice, and NEVER declined — it emitted a proposal for both
deliberate one-off traps. Both Claude arms declined both traps. An unsupervised job whose
output is actively wrong costs more review time than it saves. `--model` and
`DREAM_SYNTH_MODEL` keep the target swappable if a local model ever closes the gap.

WHAT LEAVES THE MACHINE. Clustered candidate-moment text, clipped to 600 chars per member
and capped at `--max-members` per cluster, plus the inventory. Clustering itself
(`cluster.py`, `nomic-embed-text`) is still local — but see RESULTS.md: local clustering
saves ZERO egress, because synthesis sends the same text anyway.

COST. Each `claude -p` call is invoked with `--tools ""`, which drops the Claude Code system
prompt and tool schemas from ~45,000 tokens to ~700 — measured. Do not remove it.

Usage:
  synthesize.py [--state DIR] [--repo DIR] [--model sonnet]
                [--min-occurrences 2] [--force] [--dry-run] [--limit N]
"""
import argparse, json, os, re, signal, subprocess, sys, time

DEFAULT_MODEL = os.environ.get("DREAM_SYNTH_MODEL", "sonnet")

# NOT 2. `score.py` uses 2 because 1 is fatal there: extended thinking consumes a turn, so
# --max-turns 1 makes a thinking-capable model exit non-zero with subtype "error_max_turns"
# and EMPTY stderr. Synthesis needs more headroom than that, and the reason is structural:
# --json-schema is delivered as a TOOL CALL, so every attempt at the structured answer costs
# a turn, and a proposal is a ~4,000-token document that the model sometimes re-emits.
# Measured 2026-08-16 on cluster c001: at --max-turns 2 the run failed with error_max_turns
# on both attempts, and a later probe at 4 failed at num_turns 5 while 2 and 8 succeeded —
# i.e. the turn count is stochastic, not a fixed cost. At 10 it was 5/5 with num_turns 2-4.
# There is no runaway risk: `--tools ""` means there is nothing to loop on but the answer,
# and --timeout still bounds the call.
MAX_TURNS = 10

BLAST_WEIGHTS = {"global": 3.0, "project": 1.5, "single-skill": 1.0}
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STATE = os.path.join(SCRIPT_DIR, "..", "state")
DEFAULT_REPO = os.path.join(SCRIPT_DIR, "..", "..", "..")

SCHEMA = {
    "type": "object",
    "properties": {
        "root_cause": {"type": "string"},
        "title": {"type": "string"},
        "rationale": {"type": "string"},
        "blast_radius": {"type": "string", "enum": list(BLAST_WEIGHTS)},
        "change_markdown": {"type": "string"},
    },
    "required": ["root_cause", "title", "rationale", "blast_radius", "change_markdown"],
}

SYSTEM = (
    "You improve an AI coding-agent setup by proposing exact, ready-to-apply changes to it. "
    "You reply with JSON only. You only reference files and skills that appear in the "
    "inventory you are given, and you decline rather than guess."
)

ROOT_CAUSE_RULES = """\
QUALITY BAR — a proposal that fails any of these is worthless and will be thrown away.

1. TARGET THE ROOT CAUSE, NOT THE SYMPTOM.
   The root cause is the mechanism that made the mistake LIKELY: a missing rule, a rule
   in a place the agent never reads, an absent pre-flight check, a skill whose description
   does not trigger, two rules that contradict each other, a missing tool.
   BAD  : "Remember to use the Read tool instead of cat."   <- restates the symptom as a wish
   GOOD : "Add a pre-flight line to the tool-hierarchy rule: before ANY Bash invocation
           that reads, searches or edits a file, state which dedicated tool was considered
           and why it was rejected."                        <- changes what makes it likely

2. BE READY TO APPLY, NOT READY TO DISCUSS.
   Give exact file paths from the INVENTORY and the exact final text. Never write
   "consider", "we should think about", "review whether", "it may be worth". If you cannot
   write the literal text to insert, you have not understood the problem well enough.

3. SCOPE TO THE WEIGHT OF THE EVIDENCE.
   A rule in the global file is paid for on every single turn of every session forever, so
   it must be earned by evidence from MANY separate sessions. The EVIDENCE header states a
   MAXIMUM BLAST RADIUS computed from how far this problem actually spread. You may choose
   that level or anything narrower. You may not exceed it, and you may not edit a file
   broader than it — if the maximum is "project" or "single-skill", the global rules file
   is off limits and you must fix it in the project or in the specific skill instead.
   Prefer the narrowest change that actually removes the cause.

   THERE IS ALWAYS A LEGAL TARGET, so "nowhere to put it" is never a reason to decline.
   A **basic-memory note** is available at EVERY blast radius, including single-skill, and
   is the right home whenever the lesson is environment-specific, project-specific, or a
   durable fact rather than a behavioural rule — "the up-check endpoint is `api/up`, not
   `/up`", "ollama stalls embeddings while a large model is resident". Unlike the global
   rules file it is NOT auto-injected, so it costs nothing on turns that never need it,
   which is exactly why the evidence-weight ceiling does not apply to it. Write it as
   `### NEW FILE: basic-memory://<topic-slug>` with the note body.

   Observed 2026-08-16: four clusters were declined purely because the clamp forbade the
   global file and no owned skill covered the topic. That is this rule failing, not the
   evidence failing.

4. ONE PROPOSAL, ANY NUMBER OF PARTS.
   A single proposal may legitimately edit the global rules file AND rewrite a skill AND
   add a third-party skill to external-skills.json. Do not classify the proposal into a
   type. Do not split it. Just describe every part.

5. IF THE CLUSTER DOES NOT JUSTIFY A CHANGE, SAY SO.
   Set title to exactly "NO CHANGE WARRANTED" and explain why in rationale. Emitting
   nothing is much better than emitting noise. Decline whenever ANY of these hold:
   - The evidence is raw tool output (exit codes, stack traces, file paths) with no
     indication of WHY it happened or what the agent should have done differently. You
     cannot infer a root cause from "Exit code 1" and a path, so do not pretend to.
   - The members turned out to be unrelated to each other and only look similar.
   - The fix would be a transient or environment-specific workaround, not a durable rule.

   NEVER decline for either of these reasons. Both were observed and both are wrong:

   * "An existing rule already covers this and was simply not followed."
     THAT IS THE FINDING. A rule that exists and did not fire is a BROKEN rule, and it is
     the most valuable thing this system can surface. Do not restate it -- change the
     MECHANISM so it fires: move it to a file that is actually read at that moment, attach
     it as a pre-flight to the specific tool call that goes wrong, make a skill's
     description match the trigger, add a hook, or delete a competing rule that contradicts
     it. Propose the mechanism change. Say plainly in the rationale that the rule exists and
     is not load-bearing.

   * "All the evidence comes from a single session."
     Scope is NOT your problem -- the EVIDENCE header already caps how far this proposal may
     reach, and one session is capped to the narrowest level automatically. A real problem
     seen once is still a real problem; declining it throws the finding away instead of
     scoping it. Propose the narrow fix.

   Declining is a correct, valued answer for the reasons listed above it. A wrong proposal
   costs a human's attention and teaches them to ignore the whole system -- but a wrongly
   declined proposal is worse, because nobody ever sees that it happened.
"""

CHANGE_FORMAT = """\
change_markdown MUST be markdown in exactly this shape, and nothing else:

## Root cause
<one paragraph: the mechanism, not the incident>

## Change
### <repo-relative path from the INVENTORY, or "NEW FILE: <path>">
<what to do: "Insert after the line `...`", "Replace the section `...`", "Create with:">

```
<the literal final text, verbatim, ready to paste>
```

(repeat the ### block once per FILE the proposal touches)

## How to verify it worked
<one concrete observable check a human or script can run>

Hard rules for change_markdown:
- Each file path appears in AT MOST ONE ### block. If you edit a file in several places,
  put every edit inside that one block. Never restate the same edit two different ways.
- Prefer the smallest edit that works: insert a line or a paragraph. Only replace a whole
  section when the existing text is actually wrong, not merely incomplete.
- When replacing or extending existing text, reproduce the surrounding markdown EXACTLY —
  heading level (`#`, `##`, `###`), numbering, bold markers, indentation. The INVENTORY
  shows you the real current text; copy its conventions character for character.
- The code fence contains only the final file text. No commentary inside the fence."""


def post(model: str, prompt: str, timeout: int, retries: int = 1) -> tuple:
    """One proposal from one headless Claude call. Returns (parsed_json, usage).

    Every flag here is load-bearing; the rationale for each is in `score.py`, which hit all
    of them first:
      --tools ""            ~700 prompt tokens instead of ~45,000. Measured. Do not remove.
      --max-turns 10        see MAX_TURNS.
      --setting-sources ""  otherwise the call inherits the user's own CLAUDE.md and skill
                            index, i.e. ~19k tokens of the very thing being proposed about.
      DREAM_DISABLE=1       so this pipeline's own hooks never fire on its own calls.

    Errors are read from the JSON on STDOUT, not stderr — see _one_call.
    """
    argv = [
        "claude", "-p",
        "--model", model,
        "--output-format", "json",
        "--max-turns", str(MAX_TURNS),
        "--tools", "",
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--system-prompt", SYSTEM,
        "--json-schema", json.dumps(SCHEMA),
    ]
    env = dict(os.environ)
    env["DREAM_DISABLE"] = "1"
    last = None
    for attempt in range(retries + 1):
        try:
            return _one_call(argv, prompt, env, timeout)
        except (RuntimeError, subprocess.TimeoutExpired, OSError) as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise last


def _one_call(argv, prompt, env, timeout):
    proc = subprocess.run(argv, input=prompt, env=env, timeout=timeout,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        # The reason lives in the JSON on STDOUT, not stderr — a --max-turns overrun exits
        # non-zero with empty stderr. Reporting stderr alone is what made that bug invisible.
        detail = proc.stderr.strip()
        try:
            p = json.loads(proc.stdout)
            detail = f"{p.get('subtype') or ''} {p.get('errors') or ''} {p.get('result') or ''}"
        except ValueError:
            pass
        raise RuntimeError(f"claude exit {proc.returncode}: {(detail or '<no detail>')[:300]}")
    try:
        payload = json.loads(proc.stdout)
    except ValueError:
        raise RuntimeError(f"claude returned non-JSON: {proc.stdout[:300]}")
    if payload.get("is_error"):
        raise RuntimeError(f"claude reported an error: {str(payload.get('result'))[:300]}")
    data = payload.get("structured_output")
    if not isinstance(data, dict):
        # Fall back to parsing the text result, so a model that answers in prose-wrapped
        # JSON still produces a proposal instead of a lost cluster.
        try:
            data = json.loads((payload.get("result") or "").strip().strip("`"))
        except ValueError:
            raise RuntimeError("no structured output in claude response")
    if not isinstance(data, dict) or not data.get("title"):
        raise RuntimeError(f"malformed proposal from claude: {str(data)[:200]}")
    usage = dict(payload.get("usage") or {})
    usage["cost_usd"] = payload.get("total_cost_usd") or 0.0
    return data, usage


def inventory(repo: str) -> str:
    """What actually exists in the setup, so the model proposes edits to real files."""
    repo = os.path.abspath(repo)
    lines = [f"Repo root: {repo}"]

    skills_dir = os.path.join(repo, "skills")
    if os.path.isdir(skills_dir):
        names = sorted(d for d in os.listdir(skills_dir)
                       if os.path.isdir(os.path.join(skills_dir, d)))
        lines.append(f"Owned skills (each at skills/<name>/SKILL.md): {', '.join(names)}")

    for rel in ("AGENTS.md", "external-skills.json", "install.ts", "README.md"):
        if os.path.exists(os.path.join(repo, rel)):
            lines.append(f"File: {rel}")
    lines.append("Note: CLAUDE.md is a symlink to AGENTS.md — edit AGENTS.md, never CLAUDE.md.")

    for rel in ("subagents", "settings", "scripts"):
        d = os.path.join(repo, rel)
        if os.path.isdir(d):
            lines.append(f"Dir: {rel}/ -> {', '.join(sorted(os.listdir(d))[:20])}")

    rules = os.path.join(repo, "AGENTS.md")
    if os.path.exists(rules):
        with open(rules, encoding="utf-8") as fh:
            body = fh.read()
        lines.append("\n--- AGENTS.md (the global rules file, verbatim) ---\n"
                     + body[:12000] + ("\n[...truncated]" if len(body) > 12000 else ""))
    return "\n".join(lines)


def blast_ceiling(cluster: dict) -> str:
    """Widest blast radius this cluster's evidence can justify — computed, not asked for.

    Measured on real output: given a single one-off, qwen3-coder happily proposed a rule in
    the GLOBAL file every time (7/7 singletons in testing, zero declines). Scope judgment
    was the one thing the local model reliably got wrong, and an unearned global rule taxes
    every future turn. So the ceiling is arithmetic on how many distinct sessions the
    problem actually reached, and the model only gets to choose at or below it.

    THE CLAMP STAYS NOW THAT THE MODEL IS CLAUDE. Claude scored 2.91-3.00/3 on scope
    calibration against the 30B's 1.09, so it needs the clamp far less — but the eval says
    that dimension rests on only 2 of 11 fixture groups, this is an unsupervised nightly
    job, and arithmetic on session spread cannot regress when a model version changes
    underneath it. A ceiling that is never hit costs nothing.
    """
    n = cluster.get("session_count", len(cluster.get("sessions") or []))
    if n >= 3:
        return "global"
    return "project" if n == 2 else "single-skill"


def build_prompt(cluster: dict, inv: str, max_members: int) -> str:
    ev = []
    for m in cluster["members"][:max_members]:
        text = m.get("text", "")
        ev.append(f"- [{m.get('kind', '?')} | session {m.get('session_id', '?')} | "
                  f"project {m.get('project', '?')}] {text[:600]}")
    extra = len(cluster["members"]) - len(ev)
    if extra > 0:
        ev.append(f"- (+{extra} more occurrences of the same kind, omitted)")

    return f"""You improve an AI coding-agent setup. You are given a cluster of moments from real
sessions that a similarity model judged to share one underlying problem. Produce ONE proposal
that removes the underlying cause.

=== EVIDENCE ({cluster['occurrences']} occurrences across {cluster['session_count']} \
distinct session(s); projects: {', '.join(cluster.get('projects') or ['unknown'])}) ===
MAXIMUM BLAST RADIUS: {blast_ceiling(cluster)}
{chr(10).join(ev)}

=== INVENTORY OF THE SETUP YOU ARE CHANGING ===
{inv}

=== {ROOT_CAUSE_RULES}
=== OUTPUT FORMAT ===
Return JSON with keys: root_cause, title, rationale, blast_radius, change_markdown.
- root_cause: one sentence naming the mechanism.
- title: one imperative line, under 90 chars, e.g. "Add a Bash-to-dedicated-tool pre-flight
  to the tool hierarchy rule". Or exactly "NO CHANGE WARRANTED".
- rationale: why this is worth the cost, citing the evidence count and spread. Prose.
- blast_radius: one of global | project | single-skill, chosen per rule 3.
- change_markdown: see below.

{CHANGE_FORMAT}
Only reference paths that appear in the INVENTORY, unless you prefix them with "NEW FILE: ".
Write the change so a different agent with no memory of this conversation can apply it exactly."""


def slugify(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return "-".join(s.split("-")[:6])[:40] or "proposal"


def next_id(prop_dir: str, day: str, used: set) -> str:
    seq = 0
    for name in os.listdir(prop_dir) if os.path.isdir(prop_dir) else []:
        m = re.fullmatch(rf"{day}-(\d{{4}})\.json", name)
        if m:
            seq = max(seq, int(m.group(1)))
    for pid in used:
        m = re.fullmatch(rf"{day}-(\d{{4}})", pid)
        if m:
            seq = max(seq, int(m.group(1)))
    return f"{day}-{seq + 1:04d}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--state", default=DEFAULT_STATE)
    ap.add_argument("--repo", default=DEFAULT_REPO, help="the setup being improved")
    ap.add_argument("--model", default=DEFAULT_MODEL,
                    help="claude -p model alias or full name (env: DREAM_SYNTH_MODEL)")
    ap.add_argument("--min-occurrences", type=int, default=2,
                    help="skip clusters with fewer members; 1 to synthesize singletons too")
    ap.add_argument("--max-members", type=int, default=12,
                    help="evidence lines shown to the model per cluster")
    ap.add_argument("--limit", type=int, default=0, help="stop after N clusters (0 = all)")
    ap.add_argument("--timeout", type=int, default=300,
                    help="seconds per model call; a proposal measures ~35-75s on sonnet")
    ap.add_argument("--force", action="store_true",
                    help="re-synthesize clusters that already have a proposal")
    ap.add_argument("--dry-run", action="store_true", help="print, do not write")
    a = ap.parse_args()

    state = os.path.abspath(a.state)
    clusters_path = os.path.join(state, "clusters.json")
    if not os.path.exists(clusters_path):
        print(f"no {clusters_path}; run cluster.py first", file=sys.stderr)
        return 1
    with open(clusters_path, encoding="utf-8") as fh:
        clusters = json.load(fh).get("clusters", [])

    prop_dir = os.path.join(state, "proposals")
    os.makedirs(prop_dir, exist_ok=True)
    # Sidecar index, not a field on the envelope — the envelope format is frozen. Maps the
    # cluster fingerprint to the proposal already made from it, so re-runs are cheap.
    # Lives OUTSIDE proposals/ because every consumer globs proposals/*.json and would
    # otherwise try to render this index as a malformed proposal.
    index_path = os.path.join(state, "proposals-index.json")
    index = {}
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as fh:
            index = json.load(fh)
    # Self-heal: each change.md records its own cluster key, so a lost or hand-deleted
    # index can be rebuilt from what is on disk. Without this, one missing file makes the
    # next run re-propose everything it has already proposed.
    for name in sorted(os.listdir(prop_dir)):
        if not name.endswith(".change.md"):
            continue
        with open(os.path.join(prop_dir, name), encoding="utf-8") as fh:
            m = re.search(r"^> cluster: `([0-9a-f]+)`", fh.read(2000), re.M)
        if m and m.group(1) not in index:
            index[m.group(1)] = name[: -len(".change.md")]

    todo = [c for c in clusters if c["occurrences"] >= a.min_occurrences]
    if not a.force:
        todo = [c for c in todo if c["cluster_key"] not in index]
    if a.limit:
        todo = todo[: a.limit]
    if not todo:
        print("nothing to synthesize", file=sys.stderr)
        return 0

    inv = inventory(a.repo)
    day = time.strftime("%Y%m%d", time.gmtime())
    made, used = [], {v for v in index.values() if v}
    spend = {"cost_usd": 0.0, "in": 0, "out": 0, "calls": 0, "wall_s": 0.0}

    try:
        synthesize(a, todo, inv, day, prop_dir, index, used, made, spend)
    finally:
        # The index is the whole of this script's resumability — write it even on Ctrl-C or
        # a crash, or the next run pays again for every cluster this one already did.
        if not a.dry_run:
            with open(index_path, "w", encoding="utf-8") as fh:
                json.dump(index, fh, indent=2)
    per = spend["wall_s"] / spend["calls"] if spend["calls"] else 0.0
    print(f"{len(made)} proposal(s) written -> {prop_dir}\n"
          f"  {spend['calls']} call(s) on {a.model}: ${spend['cost_usd']:.4f} total, "
          f"${spend['cost_usd'] / (spend['calls'] or 1):.4f}/cluster, "
          f"{per:.0f}s/cluster, tokens {spend['in']}/{spend['out']}", file=sys.stderr)
    return 0


def synthesize(a, todo, inv, day, prop_dir, index, used, made, spend) -> None:
    for c in todo:
        t0 = time.time()
        try:
            r, usage = post(a.model, build_prompt(c, inv, a.max_members), a.timeout)
        except Exception as e:
            print(f"  {c['cluster_id']}: model call failed ({e}); skipped", file=sys.stderr)
            continue
        spend["calls"] += 1
        spend["wall_s"] += time.time() - t0
        spend["cost_usd"] += float(usage.get("cost_usd") or 0.0)
        spend["in"] += sum(int(usage.get(k) or 0) for k in
                           ("input_tokens", "cache_read_input_tokens",
                            "cache_creation_input_tokens"))
        spend["out"] += int(usage.get("output_tokens") or 0)

        title = (r.get("title") or "").strip()
        if not title or title.upper().startswith("NO CHANGE WARRANTED"):
            # A decline is a DECISION, and an unrecorded decision is indistinguishable
            # from a bug. Writing only `None` to the index marked the cluster permanently
            # done while destroying the reasoning, so a wrong decline could never be
            # found -- which is exactly what happened: three clusters were declined and
            # there was no way to show the user why. Persist it, auditable, re-runnable
            # with --force.
            # Sibling of proposals/, derived from prop_dir because `state` is not
            # in this function's scope -- it is a local of main().
            decl_dir = os.path.join(os.path.dirname(prop_dir), "declined")
            os.makedirs(decl_dir, exist_ok=True)
            rec = {
                "cluster_key": c["cluster_key"],
                "cluster_id": c["cluster_id"],
                "occurrences": c.get("occurrences"),
                "sessions": c.get("session_count"),
                "exemplar": (c.get("exemplar") or "")[:400],
                "rationale": r.get("rationale") or "",
                "declined_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            with open(os.path.join(decl_dir, "%s.json" % c["cluster_key"]), "w") as fh:
                json.dump(rec, fh, indent=1)
            print(f"  {c['cluster_id']}: model declined "
                  f"({(r.get('rationale') or '')[:120]}); recorded in state/declined/",
                  file=sys.stderr)
            index[c["cluster_key"]] = None
            continue

        # Trust the model to pick a NARROWER scope than the evidence allows, never a wider
        # one. The prompt states the ceiling; this clamps it if the model ignored it.
        ceiling = blast_ceiling(c)
        blast = r.get("blast_radius") if r.get("blast_radius") in BLAST_WEIGHTS else ceiling
        if BLAST_WEIGHTS[blast] > BLAST_WEIGHTS[ceiling]:
            print(f"  {c['cluster_id']}: model asked for '{blast}', evidence only supports "
                  f"'{ceiling}'; clamped", file=sys.stderr)
            blast = ceiling
        pid = next_id(prop_dir, day, used)
        used.add(pid)
        slug = slugify(title)
        env = {
            "id": pid,
            "title": title,
            "rationale": (r.get("rationale") or "").strip(),
            "evidence": c["sessions"],
            "occurrences": c["occurrences"],
            "blast_radius": blast,
            "rank": round(c["occurrences"] * BLAST_WEIGHTS[blast], 3),
            "branch": f"dream/{pid}-{slug}",
            "conflicts_with": [],
            "status": "pending",
            "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        change = (r.get("change_markdown") or "").strip()
        header = (f"# {pid} — {title}\n\n"
                  f"> blast_radius: **{blast}** · occurrences: **{c['occurrences']}** "
                  f"across **{c['session_count']}** session(s) · rank **{env['rank']}**\n"
                  f"> branch: `{env['branch']}` · base: `private/trunk`\n"
                  f"> cluster: `{c['cluster_key']}`\n"
                  f"> root cause: {(r.get('root_cause') or '').strip()}\n\n"
                  f"{env['rationale']}\n\n---\n\n")

        print(f"  {c['cluster_id']} -> {pid} [{blast}] {title}  ({time.time() - t0:.0f}s)",
              file=sys.stderr)
        if a.dry_run:
            print(json.dumps(env, indent=2))
            print(header + change)
            continue

        with open(os.path.join(prop_dir, f"{pid}.json"), "w", encoding="utf-8") as fh:
            json.dump(env, fh, indent=2, ensure_ascii=False)
        with open(os.path.join(prop_dir, f"{pid}.change.md"), "w", encoding="utf-8") as fh:
            fh.write(header + change + "\n")
        index[c["cluster_key"]] = pid
        made.append(pid)


if __name__ == "__main__":
    # launchd stops jobs with SIGTERM, whose default action skips `finally` entirely — which
    # would discard the dedup index for every cluster synthesized so far, so the next run
    # pays Claude again for all of them. Turning it into SystemExit lets the `finally` run.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    sys.exit(main())
