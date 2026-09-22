#!/usr/bin/env python3
"""Extract Codex's rate-limit observations into the usage history.

Codex already persists what Claude Code throws away: every `token_count` event
in a session rollout carries a `rate_limits` block. So Codex needs no recorder —
only a scraper, and only because that storage is not guaranteed to survive.
`codex migrate-rollouts --apply` moves sessions to a new paginated thread store,
and the sqlite catalog that store uses contains no rate-limit data at all. This
lifts the observations somewhere Codex cannot reorganise them away.

Idempotent by union: existing records are read back and merged with a fresh
scan, keyed on (timestamp, observation). Re-running never duplicates, and a
record whose source rollout has since vanished is retained rather than dropped.

Window identity note: `resets_at` is computed server-side as now + remaining, so
it jitters by milliseconds between calls within one logical window. Grouping
must bucket with tolerance rather than compare for equality. Observations are
stored verbatim; that reconciliation belongs in analysis.
"""

import glob
import json
import os
from collections import defaultdict

CODEX = os.path.expanduser("~/.codex")
OUT_DIR = os.path.expanduser("~/.agents/state/usage-history/codex")


def scan():
    """Yield (timestamp, rate_limits) for every observation in the rollouts."""
    roots = [os.path.join(CODEX, "sessions"), os.path.join(CODEX, "archived_sessions")]
    for root in roots:
        for path in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
            try:
                fh = open(path, errors="replace")
            except OSError:
                continue
            with fh:
                for line in fh:
                    if "rate_limits" not in line:
                        continue
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    limits = (event.get("payload") or {}).get("rate_limits")
                    stamp = event.get("timestamp")
                    if limits and stamp:
                        yield stamp, limits


def load_existing():
    for path in glob.glob(os.path.join(OUT_DIR, "*.jsonl")):
        with open(path, errors="replace") as fh:
            for line in fh:
                try:
                    record = json.loads(line)
                except ValueError:
                    continue
                if record.get("t"):
                    yield record


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # Key on the full observation, not just the timestamp: Codex emits several
    # token_count events per second and their limits can differ.
    merged = {}
    for record in load_existing():
        merged[(record["t"], json.dumps(record.get("rate_limits"), sort_keys=True))] = record
    before = len(merged)

    for stamp, limits in scan():
        key = (stamp, json.dumps(limits, sort_keys=True))
        merged.setdefault(key, {"t": stamp, "src": "codex", "rate_limits": limits})

    by_month = defaultdict(list)
    for record in merged.values():
        by_month[record["t"][:7]].append(record)

    for month, records in by_month.items():
        records.sort(key=lambda r: r["t"])
        with open(os.path.join(OUT_DIR, f"{month}.jsonl"), "w") as fh:
            for record in records:
                fh.write(json.dumps(record, separators=(",", ":")) + "\n")

    print(f"{len(merged)} observations ({len(merged) - before} new) across {len(by_month)} months")


if __name__ == "__main__":
    main()
