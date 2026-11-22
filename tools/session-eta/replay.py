#!/usr/bin/env python3
"""Scores session-eta's estimate against real past turns: rebuilds each turn from a Claude Code transcript as
the hook would have seen it at a few checkpoints, asks each variant for the turn's end, and reports how far off.
Run: python3 replay.py [turns=12] [days=14]   (calls the local model; minutes, not seconds)
Seed history once: python3 replay.py seed"""
import glob, importlib.util, json, math, os, random, statistics, sys, time, urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("eta", f"{HERE}/session-eta.py")
eta = importlib.util.module_from_spec(spec); spec.loader.exec_module(eta)


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def turns_of(path):
    """Real user requests and everything until the next one: (ask, start, end, entries)."""
    out, cur = [], None
    for line in open(path, errors="replace"):
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if "timestamp" not in m or m.get("isSidechain"):
            continue
        c = (m.get("message") or {}).get("content")
        is_ask = m.get("type") == "user" and (isinstance(c, str) or (isinstance(c, list) and any(isinstance(x, dict) and x.get("type") == "text" for x in c)))
        text = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text") if isinstance(c, list) else ""
        if is_ask and not text.lstrip().startswith("<"):
            cur and out.append(cur)
            cur = {"ask": text.strip(), "start": ts(m["timestamp"]), "end": ts(m["timestamp"]), "entries": []}
        elif cur:
            cur["entries"].append(m)
            if m.get("type") == "assistant":
                cur["end"] = ts(m["timestamp"])
    cur and out.append(cur)
    return out


def state_at(turn, t):
    """What the hook's state and claude_said would hold t seconds into the turn."""
    now, uses, said, events, pending = turn["start"] + t, {}, [], [], {}
    for m in turn["entries"]:
        at = ts(m["timestamp"])
        if at > now:
            break
        for c in (m.get("message") or {}).get("content") or []:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_use":
                uses[c["id"]] = (at, eta.what(c["name"], c.get("input") or {}))
            elif c.get("type") == "tool_result" and c.get("tool_use_id") in uses:
                t0, w = uses.pop(c["tool_use_id"])
                events.append({"t": at, "what": w, "took": at - t0})
            elif c.get("type") == "text" and m.get("type") == "assistant" and c["text"].strip():
                said.append(c["text"].strip()[:500])
    pending = {k: {"t": t0, "what": w, "past": None} for k, (t0, w) in uses.items()}
    return {"turn": turn["start"], "ask": turn["ask"][:2000], "events": events[-30:], "pending": pending}, said[-3:], now


def ask_model(prompt):
    body = {"model": eta.MODEL, "prompt": prompt, "stream": False, "think": False, "format": "json",
            "keep_alive": "10m", "options": {"num_ctx": 8192, "temperature": 0}}
    r = urllib.request.urlopen(urllib.request.Request(f"{eta.OLLAMA}/api/generate", json.dumps(body).encode()), timeout=180)
    return json.loads(json.loads(r.read())["response"])


PERCENT_TAIL = '''Reply with only this JSON shape:
{"stages": [{"name": "Running tests", "done": false}], "stage": "Running tests", "percent_done": 40}
percent_done is how much of the WHOLE request's work is finished so far, 1-99.'''


def main():
    n, days = int(sys.argv[1]) if len(sys.argv) > 1 else 12, int(sys.argv[2]) if len(sys.argv) > 2 else 14
    cutoff = time.time() - days * 86400
    files = [f for f in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")) if os.path.getmtime(f) > cutoff]
    turns = [t for f in files for t in turns_of(f)]
    long = [t for t in turns if 180 <= t["end"] - t["start"] <= 3600 and t["entries"]]
    all_long = sorted(t["end"] - t["start"] for t in turns if t["end"] - t["start"] >= eta.SHOW_AFTER)
    random.seed(7)
    sample = random.sample(long, min(n, len(long)))
    print(f"{len(turns)} turns in {len(files)} transcripts; {len(long)} of 3-60 min; scoring {len(sample)}", flush=True)
    errs = {}
    for i, turn in enumerate(sample):
        actual = turn["end"] - turn["start"]
        others = [d for d in all_long if abs(d - actual) > 1e-6]  # leave this turn out of its own prior
        for frac in (0.1, 0.4, 0.7):
            t = max(eta.SHOW_AFTER, frac * actual)
            st, said, now = state_at(turn, t)
            base = eta.prompt_for(st, said, now)
            ends = {}
            try:
                ends["minutes"] = t + max(30, float(ask_model(base).get("minutes_left") or 5) * 60)
                p = min(99, max(1, float(ask_model(base[:base.index("Reply with only")] + PERCENT_TAIL).get("percent_done") or 50)))
                ends["percent"] = t / (p / 100)
            except Exception as e:
                print("  model error", repr(e), flush=True)
                continue
            longer = [d for d in others if d > t]
            if longer:
                ends["history"] = statistics.median(longer)
                ends["blend"] = math.sqrt(ends["percent"] * ends["history"])
            for k, end in ends.items():
                errs.setdefault(k, []).append((frac, abs(math.log(end / actual))))
            print(f"[{i + 1}/{len(sample)}] actual {eta.mmss(actual)} at {int(frac * 100)}%: " + "  ".join(f"{k} {eta.mmss(v)}" for k, v in ends.items()), flush=True)
    print("\nmedian error factor (1.0 = perfect; 2.0 = off by 2x either way)")
    for k, v in errs.items():
        by = {f: [e for ff, e in v if ff == f] for f in (0.1, 0.4, 0.7)}
        print(f"  {k:8} all {math.exp(statistics.median(e for _, e in v)):.2f}  " + "  ".join(f"@{int(f * 100)}% {math.exp(statistics.median(x)):.2f}" for f, x in by.items() if x))


def seed():
    """Seed actuals.jsonl with real turn lengths from transcripts, so history_end works from day one."""
    cutoff = time.time() - 30 * 86400
    files = [f for f in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")) if os.path.getmtime(f) > cutoff]
    with open(f"{eta.STATE}/actuals.jsonl", "a") as out:
        for f in files:
            for t in turns_of(f):
                d = t["end"] - t["start"]
                if eta.SHOW_AFTER <= d <= 4 * 3600:
                    out.write(json.dumps({"session": "seed", "turn": t["start"], "actual": round(d)}) + "\n")


if __name__ == "__main__":
    seed() if sys.argv[1:2] == ["seed"] else main()
