#!/usr/bin/env python3
"""A/B harness: can local Ollama do dream's proposal synthesis, or must it go to Claude?

Two things are measured independently, because they can fail independently:

  cluster   grouping candidate moments into root causes
            local nomic-embed-text + agglomerative  vs  Claude  vs  hand-labelled gold
  synth     turning one cluster into an applyable proposal
            qwen3-coder:30b  vs  qwen2.5-coder:14b  vs  claude (opus)  vs  claude (sonnet)

Synthesis is fed the *gold* clusters, not each arm's own clusters, so a bad clusterer
cannot contaminate a synthesis score.

Usage:
    ./ab-compare.py cluster            # clustering arms -> runs/<ts>/clustering.json
    ./ab-compare.py synth              # synthesis arms  -> runs/<ts>/synth.json
    ./ab-compare.py blind  <run-dir>   # anonymised scoring packet + key
    ./ab-compare.py check  <run-dir>   # objective correctness: do cited paths/skills exist?
    ./ab-compare.py score  <run-dir>   # merge hand-entered blind scores -> per-arm table
    ./ab-compare.py hybrid <run-dir>   # local clusters + Claude synthesis (the hybrid arm)

Env: RUN_DIR to reuse an existing run directory.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
FIXTURES = HERE / "fixtures" / "candidates.jsonl"
OLLAMA = "http://localhost:11434"

SYNTH_ARMS = [
    ("qwen3-coder:30b", "ollama"),
    ("qwen2.5-coder:14b", "ollama"),
    ("claude-opus", "claude"),
    ("claude-sonnet", "claude"),
]
CLAUDE_MODEL = {"claude-opus": "opus", "claude-sonnet": "sonnet"}


# ---------------------------------------------------------------- setup facts

def inventory():
    """Real, on-disk facts about the user's setup.

    Every arm gets this verbatim. It is also the ground truth for the correctness
    check: a proposal naming a skill or path that is not in here is hallucinating.
    """
    skills = sorted(
        p.name for p in (Path.home() / ".agents" / "skills").iterdir() if p.is_dir() or p.is_symlink()
    )
    rules = REPO / "CLAUDE.md"
    sections = re.findall(r"^## (.+)$", rules.read_text(), re.M)
    return {
        "rules_file": "~/.claude/CLAUDE.md (global, mirrored at $REPO/CLAUDE.md)",
        "rules_sections": sections,
        "skills_dir": "~/.agents/skills/<name> -> symlink into a source repo",
        "skills": skills,
        "skill_source_repo": str(REPO),
        "settings_file": "~/.claude/settings.json (hooks, permissions, env)",
        "hook_events": ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "SessionEnd"],
        "transcripts": "~/.claude/projects/<project-slug>/<session-id>.jsonl (read-only input)",
    }


INVENTORY_BLOCK = None  # filled at runtime


# ---------------------------------------------------------------- model calls

def ollama_chat(model, prompt):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": {"temperature": 0.2, "num_ctx": 16384},
    }).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/chat", body, {"Content-Type": "application/json"})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=1800) as r:
        d = json.load(r)
    return {
        "text": d["message"]["content"],
        "wall_s": round(time.monotonic() - t0, 2),
        "in_tokens": d.get("prompt_eval_count"),
        "out_tokens": d.get("eval_count"),
        "cost_usd": 0.0,
    }


def claude_chat(alias, prompt):
    """Headless claude with the user's config stripped off.

    --setting-sources '' --tools '' --strict-mcp-config keeps CLAUDE.md, skills, MCP
    servers and tool definitions out of the context, so Claude sees exactly the same
    bytes Ollama does. Without it the reference arm gets ~19k tokens of extra context
    the local arms never see and the comparison is meaningless.
    """
    cmd = [
        "claude", "-p", prompt, "--output-format", "json",
        "--model", CLAUDE_MODEL[alias],
        "--system-prompt", "You are a careful analyst. Answer only with what was asked for.",
        "--setting-sources", "", "--strict-mcp-config", "--tools", "",
    ]
    t0 = time.monotonic()
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800, cwd="/tmp")
    wall = round(time.monotonic() - t0, 2)
    d = json.loads(p.stdout)
    u = d.get("usage", {})
    return {
        "text": d["result"],
        "wall_s": wall,
        "in_tokens": u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
                     + u.get("cache_read_input_tokens", 0),
        "out_tokens": u.get("output_tokens"),
        "cost_usd": d.get("total_cost_usd", 0.0),
    }


def call(arm, kind, prompt):
    return ollama_chat(arm, prompt) if kind == "ollama" else claude_chat(arm, prompt)


def extract_json(text):
    """Lenient JSON extraction. Parse failures are recorded separately as a metric;
    they must not silently become quality scores."""
    t = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    t = re.sub(r"^```(?:json)?|```$", "", t, flags=re.M).strip()
    for opener, closer in (("{", "}"), ("[", "]")):
        i = t.find(opener)
        if i < 0:
            continue
        depth = 0
        for j in range(i, len(t)):
            if t[j] == opener:
                depth += 1
            elif t[j] == closer:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(t[i:j + 1]), None
                    except json.JSONDecodeError as e:
                        return None, f"{type(e).__name__}: {e}"
        return None, "unterminated"
    return None, "no JSON found"


# ---------------------------------------------------------------- fixtures

def load():
    return [json.loads(l) for l in FIXTURES.read_text().splitlines() if l.strip()]


def moment_text(m):
    s = f"[{m['project']} / session {m['session_id'][:8]} / {m['kind']}] {m['text']}"
    if m.get("context"):
        s += f"\n    surrounding context: {m['context']}"
    return s


def run_dir():
    d = os.environ.get("RUN_DIR")
    if d:
        p = Path(d)
    else:
        p = HERE / "runs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    p.mkdir(parents=True, exist_ok=True)
    return p


# ---------------------------------------------------------------- clustering

def embed(texts):
    body = json.dumps({"model": "nomic-embed-text", "input": texts}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/embed", body, {"Content-Type": "application/json"})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.load(r)
    return d["embeddings"], round(time.monotonic() - t0, 2)


def adjusted_rand(a, b):
    """ARI without sklearn. 1.0 = identical partition, ~0.0 = chance."""
    c2 = lambda n: n * (n - 1) / 2
    tab = {}
    for x, y in zip(a, b):
        tab[(x, y)] = tab.get((x, y), 0) + 1
    ra, rb = {}, {}
    for (x, y), v in tab.items():
        ra[x] = ra.get(x, 0) + v
        rb[y] = rb.get(y, 0) + v
    n = len(a)
    idx = sum(c2(v) for v in tab.values())
    ea = sum(c2(v) for v in ra.values())
    eb = sum(c2(v) for v in rb.values())
    exp = ea * eb / c2(n)
    mx = (ea + eb) / 2
    return round((idx - exp) / (mx - exp), 3) if mx != exp else 1.0


def do_cluster():
    import numpy as np
    from scipy.cluster.hierarchy import fcluster, linkage
    from scipy.spatial.distance import pdist

    out = run_dir()
    cands = load()
    gold = [c["gold_cluster"] for c in cands]
    n_gold = len(set(gold))
    res = {"n_candidates": len(cands), "n_gold_clusters": n_gold, "arms": {}}

    # --- local arm: nomic-embed-text + agglomerative clustering.
    # Swept over 4 text encodings x 4 linkage methods x every distance threshold, and the
    # BEST cell is reported as the local arm's score. That is deliberately generous: at
    # night there are no gold labels, so the threshold cannot be tuned. If local still
    # loses under oracle tuning, it loses for real.
    encodings = {
        "text+context": [moment_text(c) for c in cands],
        "text-only": [c["text"] for c in cands],
        "text+kind": [f"{c['kind']}: {c['text']}" for c in cands],
    }
    grid, embed_s, best_cell = [], 0.0, None
    for enc, texts in encodings.items():
        vecs, s = embed(texts)
        embed_s += s
        X = np.array(vecs)
        X /= np.linalg.norm(X, axis=1, keepdims=True)
        D = pdist(X, "cosine")
        for meth in ("average", "complete", "ward", "single"):
            t0 = time.monotonic()
            Z = linkage(D, method=meth)
            sweep = []
            for thr in [round(x, 3) for x in np.arange(0.02, 0.90, 0.005)]:
                lab = fcluster(Z, thr, criterion="distance").tolist()
                sweep.append({"threshold": thr, "k": len(set(lab)), "ari": adjusted_rand(gold, lab)})
            b = max(sweep, key=lambda x: x["ari"])
            # what you could ship: no gold labels, so the only lever is a cluster-count prior
            ship = min((x for x in sweep if 6 <= x["k"] <= 14),
                       key=lambda x: abs(x["k"] - n_gold), default=b)
            cell = {"encoding": enc, "linkage": meth, "cluster_s": round(time.monotonic() - t0, 3),
                    "oracle_best": b, "shipping_operating_point": ship,
                    "ari_at_known_k": adjusted_rand(gold, fcluster(Z, n_gold, "maxclust").tolist())}
            grid.append(cell)
            if best_cell is None or cell["oracle_best"]["ari"] > best_cell["oracle_best"]["ari"]:
                best_cell = cell
    res["arms"]["local-nomic-agglomerative"] = {
        "embed_s": round(embed_s, 2), "cost_usd": 0.0,
        "best_cell": best_cell, "grid": grid,
        "note": "score reported is the oracle-tuned best of 12 configurations; "
                "an untuned nightly run cannot reach it",
    }

    # --- reference arm: Claude groups the same moments from text alone
    listing = "\n".join(f"{c['uuid']}: {moment_text(c)}" for c in cands)
    prompt = (
        "Below are candidate friction moments mined from an engineer's AI coding sessions.\n"
        "Group them by ROOT CAUSE - the underlying reason the interaction went wrong - not by\n"
        "surface topic, tool name, or project. A moment that shares no root cause with any other\n"
        "belongs in a group of one.\n\n"
        f"{listing}\n\n"
        'Answer with JSON only: {"groups": [{"label": "short-kebab-name", "members": ["m-0001", ...]}]}'
    )
    for alias in ("claude-opus", "claude-sonnet"):
        r = claude_chat(alias, prompt)
        parsed, err = extract_json(r["text"])
        entry = {k: r[k] for k in ("wall_s", "in_tokens", "out_tokens", "cost_usd")}
        entry["raw"] = r["text"]
        entry["parse_error"] = err
        if parsed:
            m2g = {m: g["label"] for g in parsed["groups"] for m in g["members"]}
            lab = [m2g.get(c["uuid"], f"__missing__{c['uuid']}") for c in cands]
            entry.update(k=len(set(lab)), ari=adjusted_rand(gold, lab), labels=lab,
                         unassigned=sum(1 for x in lab if x.startswith("__missing__")))
        res["arms"][alias] = entry

    (out / "clustering.json").write_text(json.dumps(res, indent=2))
    print(f"-> {out}/clustering.json")
    for name, a in res["arms"].items():
        if "ari" in a:
            print(f"  {name:32s} k={a['k']:<3} ARI={a['ari']:<6} {a['wall_s']}s ${a['cost_usd']:.4f}")
        else:
            b = a["best_cell"]
            print(f"  {name:32s} oracle-best ARI={b['oracle_best']['ari']} "
                  f"(k={b['oracle_best']['k']}, {b['encoding']}/{b['linkage']}) | "
                  f"untuned ARI={b['shipping_operating_point']['ari']} | "
                  f"ARI@known-k={b['ari_at_known_k']} | {a['embed_s']}s $0")
    return out


# ---------------------------------------------------------------- synthesis

SYNTH_PROMPT = """You maintain an engineer's AI-agent setup. Overnight, a job mines his Claude Code
session transcripts for moments where the interaction went wrong. It has grouped the moments below
because it believes they share one root cause. Your job is to decide whether this group justifies a
change to his setup, and if so, to write that change.

HIS SETUP, exactly as it exists on disk. Do not reference anything that is not listed here:
{inventory}

A change may be any of: an edit to a section of the rules file, a new or edited skill, a hook in
settings.json, or a permission change. Prefer the smallest mechanism that actually prevents a
recurrence. A rule that already exists and is being ignored is evidence that prose is not working
for this class of problem - say so and propose something with teeth instead of restating the rule.

blast_radius must be one of: "global" (applies to every session), "project" (one project or repo),
"single-skill" (one skill). A pattern seen once, in one project, is not global.

If these moments do not justify any change - too few, too specific, or not an agent-behaviour
problem at all - return exactly {{"proposal": null, "reason": "<one sentence>"}}.

THE GROUP ({n} moments across {s} sessions):
{moments}

Answer with JSON only, no prose before or after:
{{"proposal": {{
  "title": "<one line, imperative>",
  "root_cause": "<what is actually going wrong, one or two sentences>",
  "change": {{"target": "<exact file path or skill name from the inventory above>",
              "mechanism": "<rule-edit | new-skill | skill-edit | hook | permission>",
              "detail": "<the concrete change, specific enough to apply without asking a follow-up question>"}},
  "blast_radius": "<global|project|single-skill>",
  "rationale": "<why this is worth doing>"
}}}}"""


def do_synth():
    out = run_dir()
    cands = load()
    groups = {}
    for c in cands:
        groups.setdefault(c["gold_cluster"], []).append(c)
    inv = json.dumps(inventory(), indent=2)
    (out / "inventory.json").write_text(inv)

    prompts = {
        gid: SYNTH_PROMPT.format(
            inventory=inv, n=len(ms), s=len({m["session_id"] for m in ms}),
            moments="\n\n".join(moment_text(m) for m in ms),
        )
        for gid, ms in groups.items()
    }
    results = {"model_load_s": {}, "groups": {
        gid: {"prompt": prompts[gid], "n": len(groups[gid]), "arms": {}} for gid in groups}}
    # Resume: a 30 GB local arm takes minutes and the run can be interrupted. Completed
    # arms are checkpointed per arm, so a rerun only pays for what is missing.
    partial = out / "synth.partial.json"
    if partial.exists():
        prev = json.loads(partial.read_text())
        results["model_load_s"].update(prev.get("model_load_s", {}))
        for gid, g in prev.get("groups", {}).items():
            if gid in results["groups"]:
                results["groups"][gid]["arms"].update(g.get("arms", {}))
        print(f"resumed: {sorted({a for g in results['groups'].values() for a in g['arms']})}",
              flush=True)

    # Arm-outer, group-inner. Ollama evicts a model to load another, so interleaving two
    # local models group-by-group reloads ~20 GB of weights on every single call. Measured:
    # that thrash made the run take >25 min without finishing. A nightly job would run one
    # model over all clusters, so the harness does the same and pays model load once per arm.
    for arm, kind in SYNTH_ARMS:
        todo = [g for g in groups if arm not in results["groups"][g]["arms"]]
        if not todo:
            print(f"skip {arm} (already complete)", flush=True)
            continue
        if kind == "ollama":
            t0 = time.monotonic()
            ollama_chat(arm, "Reply with the single word: ready")
            results["model_load_s"][arm] = round(time.monotonic() - t0, 2)
            print(f"warmed {arm} in {results['model_load_s'][arm]}s", flush=True)
        for gid in todo:
            try:
                r = call(arm, kind, prompts[gid])
            except Exception as e:
                r = {"text": "", "wall_s": None, "in_tokens": None, "out_tokens": None,
                     "cost_usd": 0.0, "error": f"{type(e).__name__}: {e}"}
            parsed, err = extract_json(r["text"])
            r["parsed"] = parsed
            r["parse_error"] = err
            results["groups"][gid]["arms"][arm] = r
            print(f"  {arm:20s} {gid:28s} {r['wall_s']}s "
                  f"{'PARSE-FAIL' if err else 'ok'} ${r['cost_usd']:.4f}", flush=True)
        (out / "synth.partial.json").write_text(json.dumps(results, indent=2))

    (out / "synth.json").write_text(json.dumps(results, indent=2))
    print(f"-> {out}/synth.json")
    totals(results)
    return out


def do_hybrid(rd):
    """Test the hybrid proposal directly: local embeddings for clustering, Claude for synthesis.

    Every other synthesis result in this harness is fed *gold* clusters, which flatters the
    hybrid - it never has to cope with a bad grouping. Here Claude is fed the clusters the
    local embedder actually produces, so the question 'does cheap clustering + good synthesis
    work?' is answered with output rather than with an assumption.
    """
    import numpy as np
    from scipy.cluster.hierarchy import fcluster, linkage
    from scipy.spatial.distance import pdist

    rd = Path(rd)
    cands = load()
    vecs, _ = embed([c["text"] for c in cands])
    X = np.array(vecs)
    X /= np.linalg.norm(X, axis=1, keepdims=True)
    lab = fcluster(linkage(pdist(X, "cosine"), "complete"), 11, "maxclust").tolist()
    clusters = {}
    for c, l in zip(cands, lab):
        clusters.setdefault(f"local-c{l}", []).append(c)

    inv = json.dumps(inventory(), indent=2)
    out = {}
    for cid, ms in sorted(clusters.items()):
        prompt = SYNTH_PROMPT.format(
            inventory=inv, n=len(ms), s=len({x["session_id"] for x in ms}),
            moments="\n\n".join(moment_text(x) for x in ms))
        r = claude_chat("claude-sonnet", prompt)
        r["parsed"], r["parse_error"] = extract_json(r["text"])
        r["gold_makeup"] = sorted({x["gold_cluster"] for x in ms})
        out[cid] = r
        p = (r["parsed"] or {}).get("proposal")
        print(f"  {cid:10s} gold={','.join(g[:22] for g in r['gold_makeup']):60s} "
              f"-> {(p or {}).get('title', 'NO PROPOSAL')[:60]}", flush=True)
    (rd / "hybrid.json").write_text(json.dumps(out, indent=2))
    print(f"-> {rd}/hybrid.json  total ${sum(r['cost_usd'] for r in out.values()):.4f}")


def totals(results):
    print("\nper-arm totals")
    print(f"  {'arm':22s} {'wall_s':>8} {'in_tok':>9} {'out_tok':>8} {'cost':>9} {'parse_fail':>11}")
    for arm, _ in SYNTH_ARMS:
        rs = [g["arms"][arm] for g in results["groups"].values()]
        w = sum(r["wall_s"] or 0 for r in rs)
        print(f"  {arm:22s} {w:8.1f} {sum(r['in_tokens'] or 0 for r in rs):9d} "
              f"{sum(r['out_tokens'] or 0 for r in rs):8d} "
              f"${sum(r['cost_usd'] for r in rs):8.4f} "
              f"{sum(1 for r in rs if r['parse_error']):5d}/{len(rs)}")


# ---------------------------------------------------------------- correctness

def do_check(rd):
    """Objective half of the correctness score: flag every path and skill name a proposal
    cites that does not exist on disk. Runs off the arm label, so it cannot be biased.

    NOT every hit is a hallucination - a proposal that *creates* a hook script legitimately
    names a path that does not exist yet. Each hit carries its mechanism and the sentence it
    came from so the scoring pass can adjudicate 'inventing' vs 'creating' in one glance.
    """
    results = json.loads((Path(rd) / "synth.json").read_text())
    inv = inventory()
    real_skills = set(inv["skills"])
    real_sections = {s.lower() for s in inv["rules_sections"]}
    report = {}
    for arm, _ in SYNTH_ARMS:
        bad, total = [], 0
        for gid, g in results["groups"].items():
            p = (g["arms"][arm].get("parsed") or {}).get("proposal")
            if not p:
                continue
            blob = json.dumps(p)
            for tok in set(re.findall(r"[~/.][\w./~-]*/[\w./~*-]+", blob)):
                tok = tok.rstrip(".,)`\"'").replace("$REPO", str(REPO))
                if any(ch in tok for ch in "*<>") or tok.endswith("/"):
                    continue
                total += 1
                if not Path(os.path.expanduser(tok)).exists() and \
                   not (REPO / tok.lstrip("./")).exists():
                    bad.append({"group": gid, "kind": "path", "token": tok,
                                "mechanism": (p.get("change") or {}).get("mechanism"),
                                "creates?": "ADJUDICATE",
                                "quote": next((s for s in re.split(r"(?<=[.;])\s", blob)
                                               if tok in s), "")[:260]})
            tgt = (p.get("change") or {}).get("target", "")
            for tok in set(re.findall(r"\b([a-z][a-z0-9]+(?:-[a-z0-9]+){1,4})\b", blob)):
                if tok in real_skills or tok.lower() in real_sections:
                    continue
                if f"skill `{tok}`" in blob or f"{tok} skill" in blob or tgt == tok:
                    total += 1
                    bad.append({"group": gid, "kind": "skill-name", "token": tok,
                                "mechanism": (p.get("change") or {}).get("mechanism"),
                                "creates?": "ADJUDICATE",
                                "quote": next((s for s in re.split(r"(?<=[.;])\s", blob)
                                               if tok in s), "")[:260]})
        report[arm] = {"references_checked": total, "n_unresolved": len(bad),
                       "unresolved_rate": round(len(bad) / total, 3) if total else None,
                       "unresolved": bad}
        print(f"  {arm:22s} {len(bad):2d}/{total:3d} references do not exist on disk "
              f"(adjudicate: invented vs to-be-created)")
    (Path(rd) / "correctness.json").write_text(json.dumps(report, indent=2))
    print(f"-> {rd}/correctness.json")


# ---------------------------------------------------------------- blind packet

def do_blind(rd):
    """Shuffle arm identities so the qualitative scoring pass cannot see which model
    wrote which proposal. Key is written to a separate file, read only after scoring."""
    import hashlib
    rd = Path(rd)
    results = json.loads((rd / "synth.json").read_text())
    cands = {c["gold_cluster"]: c for c in load()}
    key, lines = {}, []
    for gid in sorted(results["groups"]):
        g = results["groups"][gid]
        # stable per-group shuffle: hash of group id, so labels differ between groups
        order = sorted(a for a, _ in SYNTH_ARMS)
        h = int(hashlib.sha256(gid.encode()).hexdigest(), 16)
        order = order[h % len(order):] + order[:h % len(order)]
        lines.append(f"\n{'=' * 78}\nGROUP {gid}  ({g['n']} moments)\n{'=' * 78}")
        for i, arm in enumerate(order):
            tag = f"{gid}#{chr(65 + i)}"
            key[tag] = arm
            r = g["arms"][arm]
            body = json.dumps(r["parsed"], indent=2) if r["parsed"] else \
                   f"[UNPARSEABLE: {r['parse_error']}]\n{r['text'][:1500]}"
            lines.append(f"\n--- {tag} ---\n{body}")
    (rd / "blind-packet.txt").write_text("\n".join(lines))
    (rd / "blind-key.json").write_text(json.dumps(key, indent=2))
    print(f"-> {rd}/blind-packet.txt  (key in blind-key.json, do not open until scored)")


# ---------------------------------------------------------------- scoring merge

RUBRIC = ["root_cause_depth", "actionability", "correctness", "scope_calibration"]


def do_score(rd):
    """Reads scores.json ({tag: {dimension: 0-3}}), un-blinds, prints per-arm means."""
    rd = Path(rd)
    scores = json.loads((rd / "scores.json").read_text())
    key = json.loads((rd / "blind-key.json").read_text())
    per = {}
    for tag, s in scores.items():
        per.setdefault(key[tag], []).append(s)
    print(f"  {'arm':22s} " + " ".join(f"{d[:14]:>15s}" for d in RUBRIC) + f"{'TOTAL/12':>10s}")
    rows = []
    for arm, _ in SYNTH_ARMS:
        ss = per.get(arm, [])
        if not ss:
            continue
        means = [sum(x[d] for x in ss) / len(ss) for d in RUBRIC]
        rows.append((arm, means, sum(means)))
        print(f"  {arm:22s} " + " ".join(f"{m:15.2f}" for m in means) + f"{sum(means):10.2f}")
    (rd / "scored.json").write_text(json.dumps(
        {a: dict(zip(RUBRIC, m), total=t) for a, m, t in rows}, indent=2))


# ---------------------------------------------------------------- main

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    arg = sys.argv[2] if len(sys.argv) > 2 else None
    if cmd == "cluster":
        do_cluster()
    elif cmd == "synth":
        do_synth()
    elif cmd == "check":
        do_check(arg)
    elif cmd == "blind":
        do_blind(arg)
    elif cmd == "score":
        do_score(arg)
    elif cmd == "hybrid":
        do_hybrid(arg)
    else:
        print(__doc__)
