#!/usr/bin/env python3
"""Benchmark runner for read-image-locally. One model at a time, via the production path (vision_judge.py --models <m>).

  python3 run.py --models lfm3-vl,gemma4:e4b,gemma4:12b          # generate synthetic set if absent, run, print table
  python3 run.py --models some-new-model:tag                       # adds a column; earlier results in --out are kept
  python3 run.py --models m --manifest path/to/manifest.json       # e.g. a private real-screenshot set (same format)
  python3 run.py --selftest
Results: <out>/results/<model>.json ; summary: <out>/summary.md. Default out: ~/.agents/state/read-image-locally/vision-bench/<date>/synthetic
Grading: strict = whole answer equals expected after light cleanup (so invented extras fail); `extras` counts answers that
contain the expected value but fail strict. Hallucination = on absent items (expected NOT_PRESENT or count 0), asserting something.
"""
import argparse, datetime, glob, json, os, re, statistics, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
JUDGE = os.path.join(HERE, "..", "vision_judge.py")
NEG = re.compile(r"^\W*(not[ _]present|none|no such|not found|n/?a|there is no|no\b)", re.I)


def clean(a):
    a = re.sub(r"```\w*", "", a).strip()
    a = re.sub(r"^(answer|value|result)\s*:\s*", "", a, flags=re.I).strip()
    return a.strip("`'\" \n").rstrip(".").strip()

def sq(s): return re.sub(r"\s+", "", s)

def first_num(a):
    m = re.search(r"-?\d[\d,]*\.?\d*", a)
    return float(m.group().replace(",", "").rstrip(".")) if m else None

def num_of(s):
    s = str(s).strip()
    if not re.fullmatch(r"[$#]?-?[\d,]*\.?\d+%?", s): return None
    return float(re.sub(r"[$#,%]", "", s))

def field_ok(exp, got):
    if got is None: return False
    got = str(got).strip(); e, g = num_of(exp), num_of(got)
    return abs(e - g) < 1e-6 if e is not None and g is not None else sq(got).lower() == sq(str(exp)).lower()

def grade(item, ans):
    """-> (score 0..1, strict_ok, contains_ok, hallucinated)"""
    k, exp = item["kind"], item["expected"]
    if k == "json":
        try: obj = json.loads(ans)
        except Exception: return 0.0, False, False, False
        if not isinstance(obj, dict): return 0.0, False, False, False
        s = sum(field_ok(v, obj.get(key)) for key, v in exp.items()) / len(exp)
        return s, s == 1, s == 1, False
    c = clean(ans)
    if k == "num":
        n = first_num(c); ok = n is not None and abs(n - exp) <= item.get("tol", 0)
        # strict: the answer must be just the number (optionally with a unit word), not a paragraph
        strict = ok and len(c) <= 12
        return float(strict), strict, ok, item["absent"] and not strict and n not in (None, 0.0)
    if exp == "NOT_PRESENT":
        ok = bool(re.match(r"^\W*not[ _]present\W*$", c, re.I))
        return float(ok), ok, bool(re.search(r"not[ _]present", ans, re.I)), not ok and not NEG.match(c)
    f = (lambda s: sq(s).lower()) if k == "ci" else sq
    strict = f(c) == f(exp)
    contains = f(exp) in f(ans)
    return float(strict), strict, contains, item["absent"] and not strict and not NEG.match(c)

def selftest():
    it = lambda **kw: dict(dict(kind="exact", expected="", tol=0, absent=False), **kw)
    assert grade(it(expected="aB1l"), "`aB1l`")[0] == 1
    assert grade(it(expected="aB1l"), "aBIl")[0] == 0
    assert grade(it(expected="aB1l"), "aB1l (line 4)") == (0.0, False, True, False)
    assert grade(it(kind="ci", expected="187 ms"), "187ms.")[0] == 1
    assert grade(it(kind="num", expected=3, absent=False), "3")[0] == 1
    assert grade(it(kind="num", expected=12, tol=4), "about 15 units")[2]
    assert grade(it(kind="num", expected=0, absent=True), "2")[3] is True
    assert grade(it(kind="num", expected=0, absent=True), "0")[0] == 1
    assert grade(it(expected="NOT_PRESENT", absent=True), "NOT_PRESENT")[0] == 1
    assert grade(it(expected="NOT_PRESENT", absent=True), "12345")[3] is True
    assert grade(it(expected="NOT_PRESENT", absent=True), "None")[3] is False
    j = it(kind="json", expected={"a": "$1,200", "b": "x-1", "c": "97.3%"})
    assert grade(j, '{"a":1200,"b":"X-1","c":"97.3"}')[0] == 1
    assert abs(grade(j, '{"a":1,"b":"x-1","c":"97.3%"}')[0] - 2 / 3) < 1e-9
    assert grade(j, "oops")[0] == 0
    print("selftest ok")


def call(model, img, prompt, as_json):
    cmd = [sys.executable, JUDGE, img, "--prompt", prompt, "--models", model] + (["--json"] if as_json else [])
    t = time.time()
    try: p = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired: return "", None, time.time() - t, "timeout"
    wall = time.time() - t
    m = re.match(r"\[read-image-locally OK\] model=\S+ ([\d.]+)s\n", p.stdout)
    if not m: return "", None, wall, (p.stdout + p.stderr).strip()[:200]
    return p.stdout[m.end():].strip(), float(m.group(1)), wall, ""

def ollama_ps(model):
    out = subprocess.run(["ollama", "ps"], capture_output=True, text=True).stdout
    for l in out.splitlines():
        if l.split() and l.split()[0].split(":latest")[0] == model.split(":latest")[0]:
            c = re.split(r"\s{2,}", l.strip()); return f"{c[2]} {c[3]}"  # SIZE, PROCESSOR
    return ""

def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))] if xs else float("nan")

def run_model(model, items, base, outdir, log):
    safe = model.replace("/", "_").replace(":", "_")
    part = os.path.join(outdir, "results", safe + ".partial.json")  # checkpoint so a killed run resumes
    os.makedirs(os.path.join(outdir, "results"), exist_ok=True)
    rows, mem = [], ""
    if os.path.exists(part): rows = json.load(open(part))
    done = {r["id"] for r in rows}
    subprocess.run(["ollama", "stop", model], capture_output=True); time.sleep(2)
    for n, it in enumerate(items):
        if it["id"] in done: continue
        n = len(rows)
        ans, dt, wall, err = call(model, os.path.join(base, it["image"]), it["prompt"], it["json"])
        if n == 2 or (not mem and n > 2): mem = ollama_ps(model)
        s, strict, contains, hall = grade(it, ans) if not err else (0.0, False, False, False)
        rows.append(dict(id=it["id"], category=it["category"], level=it["level"], score=s, strict=strict, extras=contains and not strict,
                         hallucinated=bool(hall), expected=it["expected"], got=ans, secs=dt, wall=wall, cold=n == 0, error=err, prompt=it["prompt"]))
        json.dump(rows, open(part, "w"))
        log(f"{model:14} {n+1:3}/{len(items)} {it['id']:22} {'OK ' if s == 1 else f'{s:.1f}'} {dt or 0:5.1f}s {'H' if hall else ''} {err}")
    mem = mem or ollama_ps(model)
    subprocess.run(["ollama", "stop", model], capture_output=True)
    json.dump(dict(model=model, mem=mem, rows=rows), open(os.path.join(outdir, "results", safe + ".json"), "w"), indent=1)
    if os.path.exists(part): os.remove(part)

def summarize(outdir):
    res = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(outdir, "results", "*.json"))) if not f.endswith(".partial.json")]
    if not res: return ""
    cats = sorted({r["category"] for m in res for r in m["rows"]})
    acc = lambda rows: 100 * sum(r["score"] for r in rows) / len(rows) if rows else float("nan")
    L = ["| model | " + " | ".join(cats) + " | overall | halluc. | extras | p50 s | p90 s | cold s | memory |", "|" + "---|" * (len(cats) + 8)]
    for m in res:
        rows = m["rows"]; warm = [r["secs"] for r in rows if r["secs"] and not r["cold"]]; cold = [r["secs"] for r in rows if r["cold"]]
        L.append(f"| {m['model']} | " + " | ".join(f"{acc([r for r in rows if r['category'] == c]):.0f}" for c in cats) +
                 f" | **{acc(rows):.1f}** | {sum(r['hallucinated'] for r in rows)} | {sum(r['extras'] for r in rows)} | {pct(warm, .5):.1f} | {pct(warm, .9):.1f} | {cold[0] if cold and cold[0] else float('nan'):.1f} | {m['mem']} |")
    L += ["", "Accuracy by level (%):", "", "| model | L1 | L2 | L3 |", "|---|---|---|---|"]
    for m in res: L.append(f"| {m['model']} | " + " | ".join(f"{acc([r for r in m['rows'] if r['level'] == l]):.0f}" for l in (1, 2, 3)) + " |")
    t = "\n".join(L); open(os.path.join(outdir, "summary.md"), "w").write(t + "\n"); return t

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="lfm3-vl,gemma4:e4b,gemma4:12b"); ap.add_argument("--manifest")
    ap.add_argument("--out"); ap.add_argument("--seed", type=int, default=1); ap.add_argument("--per-level", type=int, default=3)
    ap.add_argument("--limit", type=int, default=0); ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest: return selftest()
    out = a.out or os.path.expanduser(f"~/.agents/state/read-image-locally/vision-bench/{datetime.date.today()}/synthetic")
    man = a.manifest or os.path.join(out, "manifest.json")
    if not os.path.exists(man):
        subprocess.run([sys.executable, os.path.join(HERE, "gen.py"), "--out", out, "--seed", str(a.seed), "--per-level", str(a.per_level)], check=True)
    items = json.load(open(man))["items"]
    if a.limit: items = items[::max(1, len(items) // a.limit)][:a.limit]
    os.makedirs(out, exist_ok=True)
    lf = open(os.path.join(out, "run.log"), "a")
    def log(s): print(s, flush=True); lf.write(s + "\n"); lf.flush()
    for m in [x.strip() for x in a.models.split(",") if x.strip()]:
        run_model(m, items, os.path.dirname(man), out, log)
    print("\n" + summarize(out))

if __name__ == "__main__": main()
