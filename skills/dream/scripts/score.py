#!/usr/bin/env python3
"""Stage 2 of dream capture: judge stage-1 moments with Claude, headless.

Stage 1 (`prefilter.py`) narrows the corpus deterministically and deliberately
over-collects. This stage reads `state/stage1/*.jsonl` and decides, per moment,
"did something go wrong here, or is there something to learn here" -- then
writes the survivors to `state/candidates/<session-id>.jsonl`, which is what the
rest of the pipeline consumes.

WHY A MODEL. The audit measured that ~60 of 91 missed moments are unreachable by
ANY pattern list and only ~15 by vocabulary expansion. The two classes that
matter have no fixed vocabulary at all:

  * understated dissatisfaction -- "i thought", "i could've sworn", "hmm",
    "i guess", "are you sure?", "is that what im hearing?"
  * assistant self-retraction -- "I've been guessing and I was wrong four times"

WHY CLAUDE. A separate A/B eval scored local Ollama 4.5-6.0/12 against Claude
11.1-11.8/12 on this exact task. Note that this is the one stage in the pipeline
that leaves the machine; `--model` and `DREAM_SCORE_MODEL` make it swappable,
and `--dry-run` shows the cost before you spend it.

RESUMABLE AND CACHE-FRIENDLY. Every verdict is keyed by a hash of the moment
text and appended to `state/score-cache.jsonl`. Re-running skips everything
already judged, an interrupted run loses at most one batch, and re-running
stage 1 (which renumbers segments) does not invalidate unchanged text.

COST. Each `claude -p` call is invoked with `--tools ""`, which drops the Claude
Code system prompt and tool schemas from ~45,000 tokens to ~700 -- measured, and
the difference between a $60 backfill and an $800 one. Do not remove it.

Usage:
    score.py [--state DIR] [--session ID]... [--model sonnet] [--batch 25]
             [--jobs 4] [--limit N] [--dry-run] [--json]
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ledger      # noqa: E402  (state_dir only -- the ledger format is untouched)
import prefilter   # noqa: E402  (clip: keep the END of a long moment)

DEFAULT_MODEL = os.environ.get("DREAM_SCORE_MODEL", "sonnet")
DEFAULT_BATCH = 25
DEFAULT_JOBS = 4
DEFAULT_TIMEOUT = 240
ITEM_CHARS = 700
SOURCE = "score"
KINDS = ("friction", "preference", "endorsement")

SYSTEM = (
    "You triage moments captured from a software engineer's AI-coding sessions. "
    "You reply with JSON only. You judge stance, never verbosity."
)

INSTRUCTIONS = """\
For each numbered moment below, decide ONE thing: is there something to learn
from it -- did the interaction go wrong, or did the human state a durable rule?

KEEP a moment when it shows any of:
- the human correcting, rejecting, re-explaining, or pushing back, however brief
  or polite. "try again", "are you sure?", "i thought it was X", "hmm", "i guess
  im not sold", "we don't need the question mark", "i still see a line" are all
  corrections. So is a question that implies the answer given was wrong.
- the human expressing doubt, surprise, impatience or dissatisfaction, even
  understated, even buried mid-turn.
- the human stating a standing preference or rule meant to outlive this task.
- the assistant retracting itself, admitting an error or a wrong guess,
  abandoning a hypothesis, reporting that it misled the human, or disclosing
  that it changed something in the human's environment or files.
- a tool failure that actually blocked or misled the work.
- the human ENDORSING A WAY OF WORKING they want repeated -- "I love that
  pattern", "yes, keep doing it that way", "that's exactly the right call".
  Naming a method that worked is as reusable as naming one that failed. This is
  a narrow gate: it must point at a repeatable PRACTICE, not at an outcome.

DROP a moment when it is:
- a task brief, a spec, or a plan -- INCLUDING one that dictates method ("BDD
  throughout", "scaffold first", "ask me before you spend money"). Briefing is
  not correcting and it is not a standing rule. Drop it.
- a question with no dissatisfaction behind it.
- bare approval, thanks, or agreement -- "thanks", "nice", "ok great", "perfect".
  Praise for an OUTCOME is noise; only praise that names a repeatable practice is
  an endorsement. "looks good" is a drop; "I love that you commit the learning
  back into the skill immediately" is a keep.
- assistant narration of what it is about to do, or a report of normal progress
  or success.
- a tool result whose non-zero exit was the expected answer to a probe (checking
  whether a path exists, a grep with no match, verifying a branch has no
  upstream).

RULES
- LENGTH IS NOT EVIDENCE. A four-word objection matters more than a 300-word
  briefing. Never keep a moment because it is long, detailed or well-written,
  and never drop one because it is short or casual.
- Judge each moment on its own. Segments of one long turn are numbered
  separately on purpose: keep the ones that object and drop the ones that brief.
- "kind" is "preference" only when the human states a rule about HOW TO WORK
  that is meant to outlive this project -- usually prompted by the agent having
  just got it wrong, or phrased as a standing rule. A first-message brief is
  never a preference.
- "kind" is "endorsement" when the human approves a PRACTICE they want repeated.
  A preference is "do it this way from now on"; an endorsement is "what you just
  did was right, keep doing it". If it names no repeatable practice, drop it
  rather than calling it an endorsement.
- Everything else you keep is "friction".
- When you are genuinely unsure, KEEP. An earlier stage already discarded most
  of the corpus; one false keep is cheap and one miss is not.
- "why" is at most 15 words, concrete, and quotes or names the actual trigger.

Reply with {"items":[...]}, one entry per moment, every moment present:
  {"i": <number>, "keep": true|false, "kind": "friction"|"preference",
   "why": "<short reason, or empty when keep is false>"}

MOMENTS
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "i": {"type": "integer"},
                    "keep": {"type": "boolean"},
                    "kind": {"type": "string", "enum": list(KINDS)},
                    "why": {"type": "string"},
                },
                "required": ["i", "keep"],
            },
        }
    },
    "required": ["items"],
}


# ------------------------------------------------------------------ paths / io

def stage1_dir(state=None):
    return os.path.join(state or ledger.state_dir(), "stage1")


def candidates_dir(state=None):
    return os.path.join(state or ledger.state_dir(), "candidates")


def cache_path(state=None):
    return os.path.join(state or ledger.state_dir(), "score-cache.jsonl")


def is_certain(rec):
    """Moments that need no judgement. A denied or interrupted tool call is the
    user physically stopping the agent -- that is ground truth, not an opinion,
    and sending it to the judge only invites it to be argued away (measured: the
    judge dropped a `[Request interrupted by user]` turn). Free, and one fewer
    thing that can go wrong."""
    return rec.get("kind") == "rejection"


def moment_hash(rec):
    """Verdicts are keyed by content, not position, so re-running stage 1 (which
    renumbers segments) does not throw the cache away."""
    payload = "%s\x00%s\x00%s" % (
        rec.get("role", ""), rec.get("kind", ""), rec.get("text", "")
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def read_jsonl(path):
    try:
        fh = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return
    with fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if isinstance(obj, dict):
                yield obj


def load_cache(state=None):
    cache = {}
    for row in read_jsonl(cache_path(state)):
        h = row.get("h")
        if h:
            cache[h] = row
    return cache


def load_moments(state=None, sessions=None):
    """All stage-1 moments, in file order, as a list."""
    d = stage1_dir(state)
    try:
        names = sorted(os.listdir(d))
    except OSError:
        return []
    out = []
    for name in names:
        if not name.endswith(".jsonl"):
            continue
        sid = name[: -len(".jsonl")]
        if sessions and sid not in sessions:
            continue
        for rec in read_jsonl(os.path.join(d, name)):
            rec.setdefault("session_id", sid)
            out.append(rec)
    return out


# ------------------------------------------------------------------ the model

def render(batch):
    """Render one batch. `text` only -- `context` is deliberately NOT shown.

    It is tempting: stage-1 segments are short now (defect 7), and the moment
    record already carries a `context` field, so surrounding it looks free. It is
    not. Measured 2026-08-16, 3 reps on the 12 gold moments the judge had
    discarded: text-only kept 22/36, and the SAME text with its surrounding turn
    appended as clearly-labelled, explicitly-not-to-be-judged context kept 15/36
    -- back to the level of not having split the turn at all. The judge averages
    whatever is in front of it, and dilution is the defect. `context` stays in
    the record for the human and for synthesis; it does not go to the judge.
    """
    parts = []
    for n, rec in enumerate(batch, 1):
        role = rec.get("role") or "user"
        if role == "tool":
            head = "[%d] tool result (%s)" % (n, (rec.get("context") or "")[:120])
        else:
            head = "[%d] %s" % (n, role)
        parts.append("%s\n%s" % (head, prefilter.clip(rec.get("text") or "", ITEM_CHARS)))
    return INSTRUCTIONS + "\n\n" + "\n\n".join(parts) + "\n"


def call_claude(prompt, model, timeout):
    """One headless Claude call. Returns (items, usage) or raises RuntimeError."""
    argv = [
        "claude", "-p",
        "--model", model,
        "--output-format", "json",
        # 2, not 1. Extended thinking counts as a turn, so --max-turns 1 makes
        # every thinking-capable model (haiku, notably) return is_error with
        # subtype "error_max_turns" and EMPTY stderr — invisible in the logs.
        # Measured: ~2/3 of batches failed this way on haiku after all retries.
        "--max-turns", "2",
        "--tools", "",                  # see COST in the module docstring
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--system-prompt", SYSTEM,
        "--json-schema", json.dumps(SCHEMA),
    ]
    env = dict(os.environ)
    env["DREAM_DISABLE"] = "1"          # never let our own hooks fire on our own calls
    proc = subprocess.run(
        argv, input=prompt, env=env, timeout=timeout,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    if proc.returncode != 0:
        # The reason usually lives in the JSON on stdout, NOT in stderr — a
        # --max-turns overrun exits non-zero with empty stderr and
        # subtype "error_max_turns" on stdout. Reporting stderr alone made a
        # bug that failed ~2/3 of batches completely invisible in the logs.
        detail = proc.stderr.strip()
        try:
            payload = json.loads(proc.stdout)
            detail = "%s %s %s" % (
                payload.get("subtype") or "",
                payload.get("errors") or "",
                payload.get("result") or "",
            )
        except ValueError:
            pass
        raise RuntimeError("claude exit %d: %s" % (proc.returncode, (detail or "<no detail>")[:300]))
    try:
        payload = json.loads(proc.stdout)
    except ValueError:
        raise RuntimeError("claude returned non-JSON: %s" % proc.stdout[:300])
    if payload.get("is_error"):
        raise RuntimeError("claude reported an error: %s" % str(payload.get("result"))[:300])
    data = payload.get("structured_output")
    if not isinstance(data, dict):
        try:
            data = json.loads(payload.get("result") or "{}")
        except ValueError:
            raise RuntimeError("no structured output in claude response")
    items = data.get("items")
    if not isinstance(items, list):
        raise RuntimeError("no items in claude response")
    usage = dict(payload.get("usage") or {})
    usage["cost_usd"] = payload.get("total_cost_usd") or 0.0
    return items, usage


def judge(batch, model, timeout, retries=1):
    """Verdict rows for one batch, keyed by moment hash. Never partial: a batch
    that cannot be judged is left uncached so the next run retries it."""
    last = None
    for attempt in range(retries + 1):
        try:
            items, usage = call_claude(render(batch), model, timeout)
        except (RuntimeError, subprocess.TimeoutExpired, OSError) as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
            continue
        out = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                rec = batch[int(item["i"]) - 1]
            except (KeyError, ValueError, TypeError, IndexError):
                continue
            kind = item.get("kind")
            if kind not in KINDS:
                kind = "friction"
            out[moment_hash(rec)] = {
                "h": moment_hash(rec),
                "keep": bool(item.get("keep")),
                "kind": kind,
                "why": (item.get("why") or "").strip()[:200],
            }
        return out, usage, None
    return {}, {}, last


# ------------------------------------------------------------------ the run

def write_candidates(moments, cache, state=None):
    """Rewrite `candidates/<session>.jsonl` from the cache. Idempotent: the file
    is a pure function of stage-1 output plus verdicts, so a re-run never
    duplicates rows and a deleted verdict really does remove a candidate."""
    out = candidates_dir(state)
    os.makedirs(out, exist_ok=True)
    by_session = {}
    for rec in moments:
        if is_certain(rec):
            verdict = {"kind": rec["kind"], "why": "user denied or interrupted the tool call"}
        else:
            verdict = cache.get(moment_hash(rec))
            if not verdict or not verdict.get("keep"):
                continue
        kind = rec.get("kind") if rec.get("role") == "tool" else verdict.get("kind", "friction")
        row = {
            "session_id": rec["session_id"],
            "uuid": rec.get("uuid", ""),
            "ts": rec.get("ts", ""),
            "project": rec.get("project", ""),
            "tool": rec.get("tool", "claude-code"),
            "role": rec.get("role", "user"),
            "seq": rec.get("seq", 0),
            "kind": kind,
            "text": rec.get("text", ""),
            "context": rec.get("context", ""),
            "why": verdict.get("why", ""),
            "source": SOURCE,
        }
        if rec.get("agent_id"):
            # Subagent provenance. cluster.py needs it to stop one parent's six
            # subagents inflating an occurrence count 6x for one event.
            row["agent_id"] = rec["agent_id"]
        by_session.setdefault(rec["session_id"], []).append(row)
    written = 0
    for sid, rows in by_session.items():
        path = os.path.join(out, sid + ".jsonl")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        os.replace(tmp, path)
        written += len(rows)
    # A session whose every moment was rejected must not keep a stale file.
    # Only sessions we actually looked at this run are eligible for removal.
    considered = {rec["session_id"] for rec in moments}
    for name in os.listdir(out):
        sid = name[: -len(".jsonl")]
        if name.endswith(".jsonl") and sid not in by_session and sid in considered:
            os.remove(os.path.join(out, name))
    return written, len(by_session)


def run(state=None, sessions=None, model=DEFAULT_MODEL, batch_size=DEFAULT_BATCH,
        jobs=DEFAULT_JOBS, limit=None, timeout=DEFAULT_TIMEOUT, dry_run=False,
        progress=None):
    moments = load_moments(state, sessions)
    cache = load_cache(state)

    todo, seen = [], set()
    for rec in moments:
        if is_certain(rec):
            continue
        h = moment_hash(rec)
        if h in cache or h in seen:
            continue
        seen.add(h)
        todo.append(rec)
    if limit is not None:
        todo = todo[:limit]

    stats = {
        "moments": len(moments), "cached": len(moments) - len(todo),
        "to_score": len(todo), "batches": 0, "failed_batches": 0,
        "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0,
        "kept": 0, "sessions": 0, "model": model,
    }
    if dry_run or not todo:
        stats["batches"] = (len(todo) + batch_size - 1) // batch_size
        if not dry_run:
            stats["kept"], stats["sessions"] = write_candidates(moments, cache, state)
        return stats

    batches = [todo[i:i + batch_size] for i in range(0, len(todo), batch_size)]
    stats["batches"] = len(batches)

    lock = threading.Lock()
    cpath = cache_path(state)
    os.makedirs(os.path.dirname(cpath), exist_ok=True)

    def work(b):
        verdicts, usage, err = judge(b, model, timeout)
        with lock:
            if err is not None or not verdicts:
                stats["failed_batches"] += 1
                if err is not None:
                    sys.stderr.write("score: batch failed: %s\n" % err)
                return
            blob = "".join(json.dumps(v, ensure_ascii=False) + "\n" for v in verdicts.values())
            fd = os.open(cpath, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
            try:
                os.write(fd, blob.encode("utf-8"))   # one write == atomic append
            finally:
                os.close(fd)
            cache.update(verdicts)
            stats["input_tokens"] += int(usage.get("input_tokens") or 0) + \
                int(usage.get("cache_read_input_tokens") or 0) + \
                int(usage.get("cache_creation_input_tokens") or 0)
            stats["output_tokens"] += int(usage.get("output_tokens") or 0)
            stats["cost_usd"] += float(usage.get("cost_usd") or 0.0)
            if progress:
                progress(stats)

    if jobs > 1:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            list(pool.map(work, batches))
    else:
        for b in batches:
            work(b)

    stats["kept"], stats["sessions"] = write_candidates(moments, cache, state)
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--state", default=None, help="state dir (default: $SKILL/state)")
    ap.add_argument("--session", action="append", default=None, help="limit to session id (repeatable)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="claude -p model (alias or full name)")
    ap.add_argument("--batch", type=int, default=DEFAULT_BATCH, help="moments per model call")
    ap.add_argument("--jobs", type=int, default=DEFAULT_JOBS, help="concurrent model calls")
    ap.add_argument("--limit", type=int, default=None, help="score at most N new moments")
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="seconds per model call")
    ap.add_argument("--dry-run", action="store_true", help="report what would be scored; call nothing")
    ap.add_argument("--json", action="store_true", help="emit stats as JSON")
    args = ap.parse_args(argv)

    done = [0]

    def tick(stats):
        done[0] += 1
        if not args.json:
            sys.stderr.write("\rscore: %d/%d batches" % (done[0], stats["batches"]))
            sys.stderr.flush()

    stats = run(
        state=args.state, sessions=set(args.session) if args.session else None,
        model=args.model, batch_size=args.batch, jobs=args.jobs, limit=args.limit,
        timeout=args.timeout, dry_run=args.dry_run, progress=tick,
    )
    if not args.json:
        sys.stderr.write("\r")
    if args.json:
        print(json.dumps(stats))
    else:
        print(
            "score%s: moments=%d cached=%d scored=%d batches=%d failed=%d "
            "kept=%d sessions=%d tokens=%d/%d"
            % (" [dry-run]" if args.dry_run else "", stats["moments"], stats["cached"],
               stats["to_score"], stats["batches"], stats["failed_batches"],
               stats["kept"], stats["sessions"],
               stats["input_tokens"], stats["output_tokens"])
        )
    return 1 if stats["failed_batches"] and stats["failed_batches"] == stats["batches"] else 0


if __name__ == "__main__":
    sys.exit(main())
