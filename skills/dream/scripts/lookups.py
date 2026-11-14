#!/usr/bin/env python3
"""dream: turn lookups repeated across sessions into candidates. No model call.

The other candidates are moments where something went WRONG. These are moments where
nothing did, but an agent spent tool calls rediscovering what an earlier session already
found: the same file read, the same section sed'd out of a skill, the same API probed.
EnvOpt (Berkeley/UChicago, 2026-11-05, https://github.com/itea1001/EnvOpt) cut agent cost
~70% by turning such repeats into cheat sheets, indexes and command templates.

Reads the `lookups` key of `state/skills/<session>.json` (written by prefilter.py) for
sidecars touched in the last --days, keeps every signature seen in >= --min-sessions
distinct sessions, and rewrites `state/candidates/_lookups.jsonl` with one row per
(signature, session). cluster.py embeds and groups them like any candidate, and
occurrences counts each session once per signature (one shared uuid per signature).

Usage: lookups.py [--state DIR] [--days 30] [--min-sessions 3] [--dry-run]
"""
import argparse, datetime, hashlib, json, os, sys, time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ledger  # noqa: E402

OUT_NAME = "_lookups.jsonl"


def collect(skills_dir, days):
    """{signature: {session_id: mtime}} over sidecars touched in the window."""
    cut = time.time() - days * 86400
    seen = defaultdict(dict)
    if not os.path.isdir(skills_dir):
        return seen
    for name in os.listdir(skills_dir):
        if not name.endswith(".json"):
            continue
        path = os.path.join(skills_dir, name)
        mtime = os.path.getmtime(path)
        if mtime < cut:
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                sigs = json.load(fh).get("lookups") or []
        except (OSError, ValueError):
            continue
        for sig in sigs:
            seen[sig][name[:-5]] = mtime
    return seen


def rows(seen, min_sessions, days):
    out = []
    for sig, sessions in sorted(seen.items()):
        if len(sessions) < min_sessions:
            continue
        uuid = "lookup-" + hashlib.sha256(sig.encode()).hexdigest()[:12]
        for sid, mtime in sorted(sessions.items()):
            out.append({
                "session_id": sid, "uuid": uuid, "seq": 0,
                "ts": datetime.datetime.fromtimestamp(mtime, datetime.timezone.utc)
                .strftime("%Y-%m-%dT%H:%M:%SZ"),
                "project": "", "tool": "claude-code", "role": "tool", "kind": "lookup",
                # the bare signature: a shared prose prefix made every lookup embed alike
                "text": sig,
                "context": f"The same discovery call ran in {len(sessions)} separate sessions "
                           f"in the last {days} days.",
                "why": "an agent rediscovered something an earlier session already found",
                "source": "lookups",
            })
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--state", default=None)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--min-sessions", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true", help="print signatures, write nothing")
    a = ap.parse_args(argv)
    state = a.state or ledger.state_dir()

    seen = collect(os.path.join(state, "skills"), a.days)
    out = rows(seen, a.min_sessions, a.days)
    kept = sorted({r["text"] for r in out}, key=lambda t: -sum(r["text"] == t for r in out))
    if a.dry_run:
        for t in kept:
            print(sum(r["text"] == t for r in out), t)
        return 0
    cand_dir = os.path.join(state, "candidates")
    os.makedirs(cand_dir, exist_ok=True)
    path = os.path.join(cand_dir, OUT_NAME)
    tmp = path + ".%d.tmp" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as fh:
        for r in out:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)
    print(f"{len(seen)} lookup signatures -> {len(kept)} repeated in >= {a.min_sessions} "
          f"sessions -> {len(out)} candidates", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
