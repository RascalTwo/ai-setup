#!/usr/bin/env python3
"""Where should auto handoff fire? Replay real Claude Code sessions under every threshold.

  python3 sweep.py [--since 2026-09-22] [--reorient 30000] [--read-weight 0.35]

Each main-chain API request is re-priced as if the session had handed off whenever a turn ended
with context >= T. A handoff costs: the turn that writes the doc (WRITE_REQS requests reading the
full context, plus DOC_TOKENS of output), then a fresh session whose start (its measured baseline,
the doc, and `--reorient` tokens of files re-read to get back up to speed) is written to the 1h
cache. After that, every request carries the smaller context: the removed tokens come off its cache
reads first, then off its cache writes (a request after an expired cache rewrites less).

Prices are per MTok from platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-03).
`--read-weight` scales cache reads for the subscription meter: a regression on the 5h window put
reads at ~0.35x list relative to writes (90% CI 0.2-0.55); 1.0 = API list price.

Only price RATIOS move the optimum (Haiku 4.5 is exactly Sonnet 5.5 halved, so they share one).
Subagents are excluded: they never hand off. Savings are of main-chain cost only.
"""
import argparse, glob, json, os, statistics
from datetime import datetime

# model: (input, 5m write, 1h write, cache read, output)
PRICES = {
    "opus-5-5":   (4.0, 5.0, 8.0, 0.20, 20.0),
    "sonnet-5-5": (2.0, 2.5, 4.0, 0.20, 10.0),
    "haiku-4-5":  (1.0, 1.25, 2.0, 0.10, 5.0),
}
WRITE_REQS = 3        # requests in the handoff-writing turn: read SKILL.md, write the doc, reply
DOC_TOKENS = 5_000    # handoff document, written as output and read back by the new session


def price_key(model):
    return next((k for k in PRICES if k in (model or "")), None)


def load_sessions(since):
    """{path: [requests]}, one entry per API message (Claude Code logs a line per content block)."""
    t0 = datetime.fromisoformat(since).timestamp()
    sessions = {}
    for path in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):
        if os.path.getmtime(path) < t0:
            continue
        by_id = {}
        for line in open(path):
            if '"usage"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            m = d.get("message") or {}
            if d.get("type") != "assistant" or d.get("isSidechain") or not price_key(m.get("model")):
                continue
            u = m["usage"]
            cc = u.get("cache_creation") or {}
            cw = u.get("cache_creation_input_tokens", 0)
            w1h = cc.get("ephemeral_1h_input_tokens", cw if not cc else 0)
            by_id[m.get("id") or len(by_id)] = dict(
                model=price_key(m["model"]), i=u.get("input_tokens", 0), cr=u.get("cache_read_input_tokens", 0),
                cw=cw, f1h=(w1h / cw if cw else 1.0), o=u.get("output_tokens", 0),
                end=m.get("stop_reason") == "end_turn")
        reqs = list(by_id.values())
        if len(reqs) >= 2:
            sessions[path] = reqs
    return sessions


def cost(r, p, cr, cw, w):
    pi, p5, p1, pr, po = p
    return (r["i"] * pi + cr * pr * w + cw * (r["f1h"] * p1 + (1 - r["f1h"]) * p5) + r["o"] * po) / 1e6


def replay(reqs, T, prices_for, w, base, reorient):
    total, offset = 0.0, 0
    for r in reqs:
        p = prices_for(r)
        ctx = r["i"] + r["cr"] + r["cw"]
        if ctx < offset:          # the real context dropped (compaction, /clear): nothing left to remove
            offset = 0
        cut = offset
        cr = max(r["cr"] - cut, 0)
        cw = max(r["cw"] - max(cut - r["cr"], 0), 0)
        total += cost(r, p, cr, cw, w)
        sim = r["i"] + cr + cw
        if T and r["end"] and sim >= T:
            fresh = base + DOC_TOKENS + reorient
            total += (WRITE_REQS * sim * p[3] * w + DOC_TOKENS * p[4]) / 1e6   # write the doc
            total += fresh * p[2] / 1e6                                         # new session's 1h cache
            offset = ctx - fresh
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-09-22")   # Opus/Sonnet 5.5 era
    ap.add_argument("--reorient", type=int, default=30_000)
    ap.add_argument("--read-weight", type=float, default=0.35)
    a = ap.parse_args()
    sessions = load_sessions(a.since)
    starts = [s[0]["i"] + s[0]["cr"] + s[0]["cw"] for s in sessions.values()]
    base = int(statistics.median(starts))
    print(f"{len(sessions)} sessions since {a.since}; fresh-session baseline (median first request) {base // 1000}k; "
          f"reorient {a.reorient // 1000}k; read weight {a.read_weight}")
    thresholds = list(range(100_000, 700_001, 10_000))
    groups = [("all sessions, actual models", None, None)]
    groups += [(f"all sessions at {k} prices", None, k) for k in PRICES]
    groups += [(f"{k} sessions at own prices", k, k) for k in ("opus-5-5", "sonnet-5-5")]
    for label, only, at in groups:
        subset = [s for s in sessions.values() if not only or sum(r["model"] == only for r in s) >= 0.9 * len(s)]
        pf = (lambda r, at=at: PRICES[at or r["model"]])
        none = sum(replay(s, 0, pf, a.read_weight, base, a.reorient) for s in subset)
        curve = [(T, sum(replay(s, T, pf, a.read_weight, base, a.reorient) for s in subset)) for T in thresholds]
        best_T, best = min(curve, key=lambda c: c[1])
        band = [T for T, c in curve if c <= best * 1.01]
        at250 = dict(curve)[250_000]
        print(f"  {label:34} n={len(subset):3}  best {best_T // 1000}k (-{100 * (1 - best / none):.1f}%)  "
              f"within 1%: {min(band) // 1000}-{max(band) // 1000}k  at 250k: -{100 * (1 - at250 / none):.1f}%")


if __name__ == "__main__":
    main()
