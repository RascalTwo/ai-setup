#!/usr/bin/env python3
"""Runs the supervisor's rules over every tool call in real Claude Code transcripts and reports what they would
have refused. Run: python3 replay.py [days=30]. Every hit goes to ~/.agents/state/supervisor/replay-hits.jsonl."""
import collections, glob, importlib.util, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("supervisor", f"{HERE}/supervisor.py")
sup = importlib.util.module_from_spec(spec); spec.loader.exec_module(sup)


def calls(days):
    """(file, tool, input) for each distinct tool call in transcripts touched within `days`."""
    seen, cutoff = set(), time.time() - days * 86400
    for f in glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True):
        if os.path.getmtime(f) < cutoff:
            continue
        for line in open(f, errors="replace"):
            if '"tool_use"' not in line:
                continue
            try:
                content = (json.loads(line).get("message") or {}).get("content") or []
            except ValueError:
                continue
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id") not in seen:
                    seen.add(b.get("id"))
                    yield f, b.get("name", ""), b.get("input") or {}


def main():
    days = float(sys.argv[1]) if len(sys.argv) > 1 else 30
    emails = sup.my_emails()
    os.makedirs(sup.STATE, exist_ok=True)
    hits, total, by_rule = [], 0, collections.Counter()
    for f, tool, inp in calls(days):
        total += 1
        v = sup.check(tool, inp, emails)
        if v:
            by_rule[v[0]] += 1
            hits.append({"rule": v[0], "tool": tool, "file": f, "input": inp})
    with open(f"{sup.STATE}/replay-hits.jsonl", "w") as out:
        out.writelines(json.dumps(h) + "\n" for h in hits)
    print(f"{total} tool calls over {days:g} days; {len(hits)} refused ({100 * len(hits) / max(total, 1):.2f}%)")
    for rule, n in by_rule.most_common():
        print(f"  {rule}: {n}")


if __name__ == "__main__":
    main()
