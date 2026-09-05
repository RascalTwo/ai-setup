#!/usr/bin/env python3
"""Attribute each rate-limit window's burn to the sessions that caused it.

Claude Code's statusline payload reports `rate_limits.{five_hour,seven_day}` as
an ACCOUNT-WIDE percentage — it says the window is 7% used, not who used it.
This scanner supplies the missing half: it reconstructs per-session cost from
the transcripts under ~/.claude/projects and writes each session's *fraction*
of the window's local burn. The widget multiplies that fraction by the live
account percentage to get "this session is 3.3 of your 7%".

Fractions, not percentages, are what land in the cache on purpose: the account
percentage arrives fresh in every statusline render, so only the split needs to
be cached. A stale cache then degrades the attribution, never the headline.

Run detached — the widget never blocks on this. See statusline-lib.sh:refresh_share.

    statusline-usage-scan.py <five_hour_resets_at> <seven_day_resets_at>

Two caveats worth knowing when reading the output:
  - Only THIS machine's transcripts are visible. claude.ai, mobile, and other
    machines burn the same window but leave nothing here, which shrinks the
    denominator and inflates every local session's share.
  - Cost is a proxy for whatever the rate limiter actually weighs. The share is
    immune to a constant re-scaling; it skews only between sessions with very
    different model/cache mixes.
"""

import datetime
import json
import os
import sys
import glob

PROJECTS = os.path.expanduser("~/.claude/projects")
OUT = os.path.expanduser("~/.claude/usage-share.json")
MEMO = os.path.expanduser("~/.claude/usage-scan-memo.json")

BUCKET = 300  # 5-minute cost buckets: fine enough for any window edge, small on disk

# $/1M tokens. Fallback is Opus-tier, the expensive guess — an unknown model
# under-reporting its cost would silently understate whoever ran it.
PRICES = {
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-fable-5": (10.0, 50.0),
    "claude-mythos-5": (10.0, 50.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
DEFAULT_PRICE = (5.0, 25.0)

# Multipliers on the input rate. Validated against Claude Code's own
# cost.total_cost_usd to within 0.1% on a sub-200k session.
CACHE_READ = 0.10
CACHE_WRITE_5M = 1.25
CACHE_WRITE_1H = 2.00

# There is deliberately NO long-context (>200k) premium here. On a 1M-context
# setup ~88% of input tokens sit above that threshold, so a premium would
# dominate the whole calculation — worth measuring rather than assuming. Fitted
# against four live sessions' cost.total_cost_usd, the flat rates above predict
# a 301-long-message session to within 1.6%; an input premium would have left
# the estimate near half the reported cost. Flat is the measured answer.


def message_cost(msg):
    """List-price cost of one assistant message, from its usage block."""
    usage = msg.get("usage") or {}
    rate_in, rate_out = PRICES.get(msg.get("model"), DEFAULT_PRICE)

    plain = usage.get("input_tokens", 0) or 0
    cache_read = usage.get("cache_read_input_tokens", 0) or 0
    creation = usage.get("cache_creation") or {}
    write_5m = creation.get("ephemeral_5m_input_tokens", 0) or 0
    write_1h = creation.get("ephemeral_1h_input_tokens", 0) or 0
    # cache_creation is absent on older entries; fall back to the flat total,
    # priced as a 5m write (the cheaper of the two — don't inflate on a guess).
    if not creation:
        write_5m = usage.get("cache_creation_input_tokens", 0) or 0
    out = usage.get("output_tokens", 0) or 0

    billed_in = (
        plain
        + CACHE_READ * cache_read
        + CACHE_WRITE_5M * write_5m
        + CACHE_WRITE_1H * write_1h
    )
    return rate_in / 1e6 * billed_in + rate_out / 1e6 * out


def scan_file(path):
    """Bucket one transcript's cost by time. Returns (session_id, {bucket: cost}).

    Deduping by message id is load-bearing, not defensive: a transcript writes
    the same message several times as it streams, and summing the rows instead
    of the messages overcounts by ~1.8x.
    """
    session = os.path.basename(path)[:-6]
    buckets = {}
    seen = set()
    try:
        fh = open(path, errors="ignore")
    except OSError:
        return session, buckets
    with fh:
        for line in fh:
            if '"usage"' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            msg = entry.get("message") or {}
            if not msg.get("usage"):
                continue
            mid = msg.get("id")
            if mid in seen:
                continue
            seen.add(mid)
            stamp = entry.get("timestamp")
            if not stamp:
                continue
            try:
                secs = datetime.datetime.fromisoformat(
                    stamp.replace("Z", "+00:00")
                ).timestamp()
            except ValueError:
                continue
            session = entry.get("sessionId") or session
            key = str(int(secs // BUCKET))
            buckets[key] = buckets.get(key, 0.0) + message_cost(msg)
    return session, buckets


def load(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def write_atomic(path, payload):
    tmp = path + ".tmp.%d" % os.getpid()
    with open(tmp, "w") as fh:
        json.dump(payload, fh)
    os.replace(tmp, path)


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: statusline-usage-scan.py <5h_resets_at> <7d_resets_at>")
    five_reset, seven_reset = int(sys.argv[1]), int(sys.argv[2])
    windows = {
        "five_hour": five_reset - 18000,
        "seven_day": seven_reset - 604800,
    }
    oldest = min(windows.values())

    memo = load(MEMO).get("files", {})
    fresh = {}
    for path in glob.glob(os.path.join(PROJECTS, "*", "*.jsonl")):
        try:
            stat = os.stat(path)
        except OSError:
            continue
        if stat.st_mtime < oldest:
            continue  # untouched since the widest window opened
        cached = memo.get(path)
        # Transcripts are append-only, so an unchanged (mtime, size) means
        # unchanged cost — reparsing 500MB every refresh is the thing to avoid.
        if cached and cached["mtime"] == stat.st_mtime and cached["size"] == stat.st_size:
            fresh[path] = cached
            continue
        session, buckets = scan_file(path)
        fresh[path] = {
            "mtime": stat.st_mtime,
            "size": stat.st_size,
            "session": session,
            "buckets": buckets,
        }

    # No scanned_at / window-start fields here: the cache file's own mtime is
    # what statusline-lib.sh checks for staleness, and nothing reads the rest.
    out = {}
    for name, start in windows.items():
        floor = start // BUCKET
        totals = {}
        for record in fresh.values():
            spent = sum(c for b, c in record["buckets"].items() if int(b) >= floor)
            if spent > 0:
                sid = record["session"]
                totals[sid] = totals.get(sid, 0.0) + spent
        grand = sum(totals.values())
        out[name] = {
            "total": round(grand, 4),
            # Fractions of local burn. The widget scales these by the live
            # account percentage, so they stay valid as that number moves.
            "shares": {s: c / grand for s, c in totals.items()} if grand else {},
        }

    write_atomic(OUT, out)
    write_atomic(MEMO, {"files": fresh})


if __name__ == "__main__":
    main()
