"""Score veil strategies on the fake fixtures: leaks (must be 0), over-blocks, time.

python3 eval/run_eval.py [model:think ...]   e.g. qwen3.5:9b:0 gemma4:12b:1
Writes a report to ~/.agents/state/veil/eval-<time>.md and prints it.
"""
import json
import os
import sys
import time
import importlib.util
from importlib.machinery import SourceFileLoader

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fixtures  # noqa: E402
if os.environ.get("VEIL_EVAL_FIXTURES") == "heldout":  # new items no threshold was tuned on
    import heldout as fixtures  # noqa: E402

_spec = importlib.util.spec_from_loader("veil", SourceFileLoader("veil", os.path.join(HERE, "..", "veil")))
veil = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(veil)
POLICY = open(os.environ.get("VEIL_EVAL_POLICY") or os.path.join(HERE, "private-test.md")).read()
DEFAULT = ["d1:2b:0"]


def survives(out, needle):
    if needle.startswith("IMG:"):
        return fixtures.IMAGES[needle[4:]] in out
    return needle in out


def run(strategy):
    model, think = strategy.rsplit(":", 1)
    veil.MODEL, veil.THINK = model, think == "1"
    veil.DEADLINE = 600  # the eval measures quality; the real 60 s limit is a hard check
    leaks, over, rows, total = [], [], [], 0
    for case in fixtures.cases():
        t = time.time()
        try:
            new, _ = veil.scrub(case["tool_response"], case["tool_input"], POLICY, case["tool_name"])
            out = json.dumps(new, ensure_ascii=False)
        except Exception as e:  # counts as a full block, like the hook's fail-closed path
            out = ""
            print(f"  {strategy} {case['name']}: ERROR {e}", file=sys.stderr)
        dt = time.time() - t
        lk = [n for n in case["block"] if survives(out, n)]
        ov = [n for n in case["pass"] if not survives(out, n)]
        leaks += [(case["name"], n) for n in lk]
        over += [(case["name"], n) for n in ov]
        total += len(case["block"]) + len(case["pass"])
        rows.append(f"| {case['name']} | {len(lk)} | {len(ov)}/{len(case['pass'])} | {dt:.1f}s |")
    return leaks, over, rows, total


def main():
    strategies = sys.argv[1:] or DEFAULT
    report = [f"# veil eval {time.strftime('%Y-%m-%d %H:%M')}", ""]
    summary = ["| strategy (model:think) | leaks | over-blocked | time |", "|---|---|---|---|"]
    for s in strategies:
        t = time.time()
        leaks, over, rows, total = run(s)
        passes = sum(len(c["pass"]) for c in fixtures.cases())
        summary.append(f"| {s} | **{len(leaks)}** | {len(over)}/{passes} ({100 * len(over) // max(passes, 1)}%) | {time.time() - t:.0f}s |")
        report += [f"## {s}", "", "| case | leaks | over-blocked | time |", "|---|---|---|---|", *rows, ""]
        report += [f"- LEAK {c}: {n}" for c, n in leaks] + [f"- over-block {c}: {n}" for c, n in over] + [""]
        print(summary[-1], flush=True)
    text = "\n".join(report[:2] + summary + [""] + report[2:])
    os.makedirs(veil.STATE, exist_ok=True)
    path = os.path.join(veil.STATE, f"eval-{time.strftime('%Y%m%d-%H%M%S')}.md")
    open(path, "w").write(text)
    print(f"\nreport: {path}")


if __name__ == "__main__":
    main()
