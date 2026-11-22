#!/usr/bin/env python3
"""Does the Extracted state section make auto handoffs better? Offline, on handoffs already on disk.

  eval.py pick                 List candidates: auto handoffs whose transcript and continuing session's transcript both exist.
  eval.py run H1 [H1 ...]      Probe, answer and grade each session (cached; rerun resumes).
  eval.py report               Per-arm scores and sizes; writes the private detail to EVAL/report.md.

For each session: S1 is the transcript up to the AUTO HANDOFF that wrote H1, S2 the session that read
H1 and continued (found by its continue prompt), up to its own handoff request or its end.
- Probes: a writer that sees S1 and what S2 did (its messages and tool calls, never its text, never
  either handoff) writes ~10 questions about details S2 needed, each with a short exact answer from S1.
- Arms: A = H1 as written; B = H1 + the Extracted state section (extract.py on S1); C = the section alone.
- Answerer: a fresh `claude -p` per arm per run, Opus 5.5 medium, no tools and no MCP (H1's lineage
  line names the transcript), given only the document.
- Grader: sees each probe's known answer and every arm's answers under shuffled labels; right 1,
  partial 0.5, wrong 0.
Everything it writes holds private session content and lives in EVAL, never in the repo."""
import concurrent.futures as cf, glob, json, os, random, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, os.path.join(HERE, "../../../skills/r2-handoff/scripts"))
import extract
from transcript import events, text_of, user_text

EVAL = os.path.expanduser(os.environ.get("AUTO_HANDOFF_EVAL", "~/.agents/state/auto-handoff/eval"))
HANDOFFS = os.path.expanduser("~/.agents/state/handoffs")
DIGEST = os.path.join(HERE, "../../../skills/r2-handoff/scripts/digest.py")
RUNS, JOBS, ARMS = 2, 4, "ABC"
LINEAGE = re.compile(r"transcript (\S+) · cwd (\S+) .*continued from: (\S+)")


def lineage(h):
    m = LINEAGE.search(open(h).readline())
    return m and {"t": m.group(1), "cwd": m.group(2), "prev": m.group(3)}


def find(text, since):
    """The oldest transcript modified since `since` that holds `text`. Lineage lines aren't trusted: an agent
    sometimes copies its predecessor's transcript path there."""
    files = [f for f in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")) if os.path.getmtime(f) >= since]
    return next((f for f in sorted(files, key=os.path.getmtime)
                 if subprocess.run(["grep", "-qF", text, f]).returncode == 0), None)


def origin(h1):
    """S1's transcript: the one that asked for h1."""
    t = (lineage(h1) or {}).get("t", "")
    ask = f"write the handoff to {h1}"
    if os.path.exists(t) and subprocess.run(["grep", "-qF", ask, t]).returncode == 0:
        return t
    return find(ask, os.path.getmtime(h1) - 3 * 86400)


def successor(h1):
    """S2's transcript: the one holding h1's continue prompt."""
    return find(f"read {h1} and continue", os.path.getmtime(h1))


def pick():
    for h in sorted(glob.glob(f"{HANDOFFS}/handoff-auto-*.md")):
        li = lineage(h)
        if li and origin(h) and successor(h):
            topic = next((l[6:].strip() for l in open(h) if l.startswith("Topic:")), "")
            print(f"{os.path.basename(h)}\t{os.path.getsize(li['t']) // 1000}kB\t{li['cwd']}\t{topic[:80]}")


def tokens_at(rows):
    """Context size at the last main-chain API reply in rows."""
    t = 0
    for _, d, _ in rows:
        u = (d.get("message") or {}).get("usage")
        if d.get("type") == "assistant" and u:
            t = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
    return t


def slices(h1, t2):
    """(S1: rows up to the request that wrote h1; S2: rows of transcript t2 from 'read h1 and continue' to its next request)."""
    s1 = [r for r in events(origin(h1)) if not r[1].get("isSidechain")]
    s1 = s1[: extract.cut_index(s1, h1)]
    s2 = [r for r in events(t2) if not r[1].get("isSidechain")]
    s2 = s2[next(i for i, (_, d, _) in enumerate(s2) if f"read {h1} and continue" in user_text(d)):]
    asks = [i for i, (_, d, c) in enumerate(s2) if d.get("type") == "user" and extract.is_request(text_of(c or ""))]
    return s1, s2[: asks[0] if asks else len(s2)]  # its first request: a later one would be a third session


def digest(rows, path, actions_only=False):
    """digest.py over rows. actions_only drops assistant text and tool-result bodies: what S2 did, not what it read or said."""
    with open(path + ".jsonl", "w") as f:
        for _, d, c in rows:
            if actions_only and d.get("type") == "assistant" and isinstance(c, list):
                d = {**d, "message": {**d["message"], "content": [x for x in c if x.get("type") == "tool_use"]}}
            if actions_only and d.get("type") == "user" and isinstance(c, list):
                continue
            f.write(json.dumps(d) + "\n")
    out = subprocess.run(["python3", DIGEST, path + ".jsonl"], capture_output=True, text=True, check=True).stdout
    open(path, "w").write(out)
    os.remove(path + ".jsonl")
    return out


def claude(prompt, system, out):
    """One fresh, tool-less Opus 5.5 medium call; the raw reply is kept in `out`."""
    if os.path.exists(out):
        return json.load(open(out))["result"]
    with tempfile.TemporaryDirectory() as cwd:  # nothing to discover there
        p = subprocess.run(["claude", "-p", "--model", "opus", "--effort", "medium", "--tools", "", "--strict-mcp-config",
                            "--setting-sources", "", "--no-session-persistence", "--system-prompt", system,
                            "--output-format", "json"], input=prompt, capture_output=True, text=True, cwd=cwd)
    if p.returncode:
        raise RuntimeError(f"claude -p failed ({p.returncode}): {p.stderr[:500] or p.stdout[:500]}")
    open(out, "w").write(p.stdout)
    return json.loads(p.stdout)["result"]


def parse_json(text):
    """The first JSON value in a model reply, fenced or not, ignoring prose around it."""
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    s = m.group(1) if m else text
    return json.JSONDecoder().raw_decode(s[min(i for i in (s.find("["), s.find("{")) if i >= 0):])[0]


PROBE_SYS = "You write exam questions from session logs. Reply with only a JSON array."
PROBE = """Below are two logs from a Claude Code agent's work for one user. SESSION 1 ran until its context was full; then a FRESH agent (SESSION 2) started with only a short written handoff from session 1 (not shown to you) and continued the work.

Write about 10 probes: details session 2 needed from session 1 and had to look up again, or acted on. Find them by comparing: files session 2 re-read or re-edited that session 1 had already touched, commands it re-ran, errors it hit again, SHAs, PR or issue numbers and URLs it used, todos or next steps it picked up, decisions and constraints it relied on.

Rules:
- Each probe is a question a continuing agent should be able to answer, with a SHORT exact answer taken from SESSION 1 (a path, a command, an error line, a number, a name, or one short sentence).
- Mix kinds: about 5 exact values (paths, commands, errors, identifiers) and about 5 about state (what was done, what was next, a decision and its reason, a user preference).
- The answer must be stated in session 1 itself. Skip anything only session 2 discovered.
- Phrase questions so they don't reveal the answer.

Reply with only a JSON array: [{{"id": "p1", "kind": "value" | "state", "q": "...", "answer": "...", "why": "what session 2 did that shows it needed this"}}]

=== SESSION 1 (digest: user messages, assistant text, one line per tool call, tool errors) ===
{s1}

=== SESSION 2 (its user messages and tool calls only) ===
{s2}
"""

ANSWER_SYS = ("You are a fresh agent continuing someone's work. You have only the document below; you cannot open any file "
              "or run anything. Reply with only a JSON object.")
ANSWER = """Answer each question from the document alone. Be short and exact. If the document doesn't say, answer "not in the document": don't guess.

Reply with only a JSON object mapping question id to answer: {{"p1": "...", ...}}

=== DOCUMENT ===
{doc}
=== QUESTIONS ===
{qs}
"""

GRADE_SYS = "You grade answers against a known answer key. Reply with only a JSON object."
GRADE = """For each question below you get the known answer and several candidate answers, each under a label. Score each candidate: 1 if it is right (states the known answer, wording aside), 0.5 if partly right (part of it, or right but vague where the key is exact), 0 if wrong, missing or "not in the document".

Reply with only a JSON object: {{"p1": {{"<label>": 1, "<label>": 0.5, ...}}, ...}}

{items}
"""


def session(h1):
    h1 = h1 if os.path.isabs(h1) else os.path.join(HANDOFFS, h1)
    sid = os.path.basename(h1)[len("handoff-auto-"):-3]
    d = os.path.join(EVAL, sid)
    os.makedirs(d, exist_ok=True)
    t2 = successor(h1)
    s1, s2 = slices(h1, t2)
    meta = {"h1": h1, "t2": t2, "s2_rows": len(s2), "s1_tokens": tokens_at(s1), "cwd": lineage(h1)["cwd"]}
    a = open(h1).read()
    if extract.HEADING in a:  # written after the hook went live: A is the prose without it
        a = a[: a.index(extract.HEADING)].rstrip() + "\n"
    sec = extract.section(origin(h1), until=h1)
    docs = {"A": a, "B": a.rstrip() + "\n\n" + sec + "\n", "C": sec + "\n"}
    for k, v in docs.items():
        open(os.path.join(d, f"arm-{k}.md"), "w").write(v)
    meta["tokens"] = {k: len(v) // 4 for k, v in docs.items()}
    json.dump(meta, open(os.path.join(d, "meta.json"), "w"), indent=1)
    pf = os.path.join(d, "probes.json")
    if not os.path.exists(pf):
        s1d = digest(s1, os.path.join(d, "s1-digest.md"))
        s2d = digest(s2, os.path.join(d, "s2-actions.md"), actions_only=True)
        probes = parse_json(claude(PROBE.format(s1=s1d[-280_000:], s2=s2d[:120_000]), PROBE_SYS, os.path.join(d, "probe-raw.json")))
        json.dump(probes, open(pf, "w"), indent=1)
    return sid, d, docs


def answer(d, docs, arm, run):
    probes = json.load(open(os.path.join(d, "probes.json")))
    qs = "\n".join(f"{p['id']}: {p['q']}" for p in probes)
    # The run number goes in the prompt so the two runs are separate samples, not one cached reply.
    raw = claude(ANSWER.format(doc=docs[arm], qs=qs) + f"\n(run {run})", ANSWER_SYS, os.path.join(d, f"answer-{arm}{run}-raw.json"))
    return parse_json(raw)


def grade(d, answers):
    out = os.path.join(d, "grades.json")
    if os.path.exists(out):
        return json.load(open(out))
    probes = json.load(open(os.path.join(d, "probes.json")))
    rng, keys, items = random.Random(d), {}, []
    for p in probes:
        cands = [(arm_run, str(a.get(p["id"], "not in the document"))) for arm_run, a in answers.items()]
        rng.shuffle(cands)
        labels = {f"x{i + 1}": arm_run for i, (arm_run, _) in enumerate(cands)}  # blind: fresh labels per probe
        keys[p["id"]] = labels
        items.append(f"### {p['id']}: {p['q']}\nKnown answer: {p['answer']}\n"
                     + "\n".join(f"- {lab}: {cands[i][1]}" for i, lab in enumerate(labels)))
    scores = parse_json(claude(GRADE.format(items="\n\n".join(items)), GRADE_SYS, os.path.join(d, "grade-raw.json")))
    result = {pid: {keys[pid][lab]: float(v) for lab, v in s.items() if lab in keys[pid]} for pid, s in scores.items() if pid in keys}
    json.dump(result, open(out, "w"), indent=1)
    return result


def run(h1s):
    with cf.ThreadPoolExecutor(JOBS) as pool:
        sessions = list(pool.map(session, h1s))
        for sid, d, docs in sessions:
            print(f"{sid}: {len(json.load(open(os.path.join(d, 'probes.json'))))} probes", flush=True)
        jobs = {(sid, f"{arm}{r}"): pool.submit(answer, d, docs, arm, r) for sid, d, docs in sessions for arm in ARMS for r in range(1, RUNS + 1)}
        answers = {}
        for (sid, ar), f in jobs.items():
            answers.setdefault(sid, {})[ar] = f.result()
        list(pool.map(lambda s: grade(s[1], answers[s[0]]), sessions))
    report()


def report():
    rows, detail = [], ["# Extracted state eval: detail (private)\n"]
    tot = {a: [] for a in ARMS}
    for d in sorted(glob.glob(f"{EVAL}/*/grades.json")):
        d = os.path.dirname(d)
        g, meta = json.load(open(f"{d}/grades.json")), json.load(open(f"{d}/meta.json"))
        probes = {p["id"]: p for p in json.load(open(f"{d}/probes.json"))}
        per = {a: [] for a in ARMS}
        for pid, s in g.items():
            for a in ARMS:
                v = [s[k] for k in s if k[0] == a]
                per[a].append(sum(v) / len(v))
        for a in ARMS:
            tot[a] += per[a]
        pct = {a: 100 * sum(per[a]) / len(per[a]) for a in ARMS}
        rows.append((os.path.basename(d), meta, len(g), pct))
        detail.append(f"## {os.path.basename(d)} ({meta['cwd']}, S1 at {meta['s1_tokens'] // 1000}k)\n")
        for pid, s in g.items():
            ab = [sum(s[k] for k in s if k[0] == a) / RUNS for a in "AB"]
            if ab[0] != ab[1]:
                detail.append(f"- {'B>A' if ab[1] > ab[0] else 'A>B'} {pid} [{probes[pid].get('kind')}] {probes[pid]['q']} → {probes[pid]['answer']}")
        detail.append("")
    print("| Session | Probes | A: as written | B: + extracted | C: extracted only | Tokens A → B (+section) |")
    print("|---|---|---|---|---|---|")
    for i, (sid, meta, n, pct) in enumerate(rows, 1):
        t = meta["tokens"]
        print(f"| S{i} | {n} | {pct['A']:.0f}% | {pct['B']:.0f}% | {pct['C']:.0f}% | {t['A']:,} → {t['B']:,} (+{t['C']:,}) |")
    overall = {a: 100 * sum(tot[a]) / max(len(tot[a]), 1) for a in ARMS}
    print(f"| **All** | {len(tot['A'])} | **{overall['A']:.0f}%** | **{overall['B']:.0f}%** | **{overall['C']:.0f}%** | |")
    wins = sum(p["B"] > p["A"] for *_, p in rows)
    print(f"\nB higher than A in {wins} of {len(rows)} sessions; B − A = {overall['B'] - overall['A']:+.1f} points.")
    open(f"{EVAL}/report.md", "w").write("\n".join(detail) + "\n" + "\n".join(f"S{i}: {r[0]}" for i, r in enumerate(rows, 1)) + "\n")


if __name__ == "__main__":
    verb = sys.argv[1] if len(sys.argv) > 1 else "report"
    {"pick": pick, "run": lambda: run(sys.argv[2:]), "report": report}[verb]()
