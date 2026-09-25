#!/usr/bin/env python3
"""Nightly scanner: transcripts -> candidate moments -> ledger.

Walks `~/.claude/projects/*/*.jsonl`, drops subagent (isSidechain) and zero-turn
sessions, skips anything the ledger already covers, runs the deterministic
prefilter on the rest, appends `state/stage1/<session-id>.jsonl`, and
records a `writer=scan` row in `state/processed.tsv`.

`--subagents` additionally walks `<slug>/<session>/subagents/**/*.jsonl`. Those
are attributed to the PARENT session (so a lesson clusters with the work that
produced it) but get their OWN ledger key, `<parent-session>/<rel-path>`,
because their `sessionId` field is the parent's and would otherwise collide.
Off by default: 4,054 files whose moments each cost a stage-2 `claude -p` call.

Holds a PID lock so it is safe to run alongside an interactive session; if a
live process already holds the lock it exits 0 without doing work.

    scan.py [--limit N] [--since YYYY-MM-DD] [--dry-run] [--backfill]
            [--projects-dir DIR] [--subagents] [--json]
"""

import argparse
import atexit
import datetime
import errno
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ledger  # noqa: E402
import prefilter  # noqa: E402

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
DEFAULT_WINDOW_DAYS = 7
SIDECHAIN_PROBE_LINES = 20
WRITER = "scan"


# --------------------------------------------------------------------------- lock

def acquire_lock(path):
    """Create a PID lock. Returns True on success, False if a live process holds it."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except OSError as exc:
            if exc.errno != errno.EEXIST:
                raise
            try:
                with open(path) as fh:
                    pid = int((fh.read() or "0").strip())
            except (ValueError, OSError):
                pid = 0
            if pid > 0 and pid != os.getpid():
                try:
                    os.kill(pid, 0)
                    return False          # holder is alive: stand down
                except OSError as kill_exc:
                    if kill_exc.errno == errno.EPERM:
                        return False      # alive, just not ours
            try:
                os.unlink(path)           # stale lock from a dead run
            except OSError:
                return False
            continue
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        atexit.register(release_lock, path)
        return True


def release_lock(path):
    try:
        with open(path) as fh:
            if int(fh.read().strip()) != os.getpid():
                return
        os.unlink(path)
    except (OSError, ValueError):
        pass


# ------------------------------------------------------------------- transcript io

def iter_transcripts(projects_dir, subagents=False):
    """Yield (path, mtime) for every `<projects_dir>/*/*.jsonl`, newest first.

    With `subagents=True`, also yields `<slug>/<session>/subagents/**/*.jsonl`.
    Deliberately opt-in: that is 4,054 extra files and ~1 GB, and each moment
    they produce costs a stage-2 `claude -p` call. A bare recursive
    `-name '*.jsonl'` would pull them in by accident, which is why the top-level
    walk stays a two-level scandir rather than a glob.
    """
    found = []
    try:
        entries = os.scandir(projects_dir)
    except OSError:
        return found
    with entries:
        for project in entries:
            if not project.is_dir():
                continue
            try:
                inner = os.scandir(project.path)
            except OSError:
                continue
            with inner:
                for f in inner:
                    if f.name.endswith(".jsonl") and f.is_file():
                        try:
                            found.append((f.path, f.stat().st_mtime))
                        except OSError:
                            pass
                    elif subagents and f.is_dir():
                        found.extend(iter_subagent_files(f.path))
    found.sort(key=lambda pair: pair[1], reverse=True)
    return found


def iter_subagent_files(session_dir):
    """(path, mtime) for every transcript under `<session_dir>/subagents/`."""
    out = []
    root = os.path.join(session_dir, prefilter.SUBAGENT_DIR)
    if not os.path.isdir(root):
        return out
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if not name.endswith(".jsonl"):
                continue
            p = os.path.join(dirpath, name)
            try:
                out.append((p, os.stat(p).st_mtime))
            except OSError:
                pass
    return out


def is_sidechain(path, probe=SIDECHAIN_PROBE_LINES):
    """True if this transcript belongs to a subagent session.

    Only the first few lines are inspected — `isSidechain` is stamped on every
    message line, so the head is representative and a full read is wasted I/O.
    """
    try:
        fh = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return True
    with fh:
        for i, line in enumerate(fh):
            if i >= probe:
                break
            try:
                obj = json.loads(line)
            except (ValueError, TypeError):
                continue
            if isinstance(obj, dict) and "isSidechain" in obj:
                return obj["isSidechain"] is True
    return False


def iso(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


# ------------------------------------------------------------------------- scanning

def scan(limit=None, since=None, dry_run=False, backfill=False, projects_dir=PROJECTS_DIR,
         subagents=False):
    """Process eligible transcripts. Returns a stats dict."""
    if since is None and not backfill:
        cutoff = datetime.datetime.now().timestamp() - DEFAULT_WINDOW_DAYS * 86400
    elif since is not None:
        cutoff = datetime.datetime.strptime(since, "%Y-%m-%d").timestamp()
    else:
        cutoff = 0.0

    known = ledger.newest_by_session()
    # Stage 1 writes to `state/stage1/`, NOT `state/candidates/`. The prefilter
    # is a recall-first funnel now; `candidates/` means "judged worth keeping"
    # and is written by score.py, which is what cluster.py reads.
    cdir = os.path.join(ledger.state_dir(), "stage1")
    if not dry_run:
        os.makedirs(cdir, exist_ok=True)

    stats = {
        "seen": 0, "old": 0, "sidechain": 0, "up_to_date": 0, "zero_turn": 0, "pipeline": 0,
        "processed": 0, "candidates": 0, "input_bytes": 0, "candidate_bytes": 0,
        "errors": 0, "subagents": 0, "subagent_candidates": 0, "sessions": [],
    }

    for path, mtime in iter_transcripts(projects_dir, subagents):
        if limit is not None and stats["processed"] >= limit:
            break
        stats["seen"] += 1
        if mtime < cutoff:
            stats["old"] += 1
            continue
        # A subagent transcript's `sessionId` IS its parent's, so it needs its
        # own ledger key or every subagent of one parent would share (and
        # clobber) a single watermark. Moments still carry the parent's
        # `session_id` -- the ledger tracks files, attribution tracks work.
        ids = prefilter.subagent_ids(path)
        if ids:
            session_id = ids[1]
            key = prefilter.subagent_key(path)
        else:
            session_id = os.path.splitext(os.path.basename(path))[0]
            key = session_id
        row = known.get(key)
        if row and row["ts"] >= iso(mtime):
            stats["up_to_date"] += 1       # nothing appended since we last looked
            continue
        if not ids and is_sidechain(path):
            stats["sidechain"] += 1
            continue

        try:
            records, summary = prefilter.extract(
                path, since_uuid=row["last_uuid"] if row else None,
                # A successful Task result in a parent transcript is a
                # subagent's closing report. When --subagents is on we read
                # that subagent's own transcript, of which the report is a
                # strict subset, so mining both would judge (and pay for) the
                # same text twice. Skip the ones we will read directly; keep
                # the ones with no transcript on disk, which are pure gain.
                skip_captured_agents=subagents,
            )
        except OSError:
            stats["errors"] += 1
            continue

        if summary.get("pipeline"):
            # Machine-driven session (`claude -p` / SDK), including score.py's own
            # calls. It yields nothing, but it MUST still get a ledger row: a full
            # backfill writes thousands of these transcripts, and without a
            # watermark every future run would re-read all of them forever.
            stats["pipeline"] += 1
            if not dry_run:
                ledger.append(key, summary["last_uuid"], 0, WRITER)
            continue

        if summary["turns"] == 0:
            stats["zero_turn"] += 1
            continue

        payload = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records)
        stats["processed"] += 1
        stats["candidates"] += len(records)
        if ids:
            stats["subagents"] += 1
            stats["subagent_candidates"] += len(records)
        stats["input_bytes"] += summary["bytes"]
        stats["candidate_bytes"] += len(payload.encode("utf-8"))
        stats["sessions"].append(
            {
                "session_id": session_id,
                "key": key,
                "project": summary["project"],
                "candidates": len(records),
                "bytes": summary["bytes"],
                "candidate_bytes": len(payload.encode("utf-8")),
            }
        )
        if dry_run:
            continue
        if payload:
            out = os.path.join(cdir, session_id + ".jsonl")
            fd = os.open(out, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
            try:
                os.write(fd, payload.encode("utf-8"))
            finally:
                os.close(fd)
        # Always advance the watermark, even with zero candidates, so the next
        # run skips work we have already looked at.
        ledger.append(key, summary["last_uuid"], len(records), WRITER)

    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--limit", type=int, default=None, help="stop after N processed sessions")
    ap.add_argument("--since", default=None, metavar="YYYY-MM-DD", help="only sessions modified on/after this date")
    ap.add_argument("--dry-run", action="store_true", help="report only; write nothing")
    ap.add_argument("--backfill", action="store_true", help="all history (default: last %d days)" % DEFAULT_WINDOW_DAYS)
    ap.add_argument("--projects-dir", default=PROJECTS_DIR)
    ap.add_argument("--subagents", action="store_true",
                    help="also mine <session>/subagents/**.jsonl (assistant-side only; "
                         "4,054 files, opt-in because every moment costs a stage-2 call)")
    ap.add_argument("--json", action="store_true", help="emit stats as JSON")
    args = ap.parse_args(argv)

    if not acquire_lock(os.path.join(ledger.state_dir(), "scan.lock")):
        return 0

    stats = scan(args.limit, args.since, args.dry_run, args.backfill, args.projects_dir,
                 args.subagents)

    if args.json:
        print(json.dumps(stats))
        return 0
    ratio = stats["input_bytes"] / stats["candidate_bytes"] if stats["candidate_bytes"] else 0.0
    print(
        "scan%s: seen=%d processed=%d candidates=%d "
        "(skipped: old=%d sidechain=%d up-to-date=%d zero-turn=%d pipeline=%d errors=%d)"
        % (
            " [dry-run]" if args.dry_run else "",
            stats["seen"], stats["processed"], stats["candidates"],
            stats["old"], stats["sidechain"], stats["up_to_date"],
            stats["zero_turn"], stats["pipeline"], stats["errors"],
        )
    )
    print(
        "bytes: input=%d candidates=%d compression=%.1fx"
        % (stats["input_bytes"], stats["candidate_bytes"], ratio)
    )
    if stats["subagents"]:
        print(
            "subagents: files=%d candidates=%d (of the totals above)"
            % (stats["subagents"], stats["subagent_candidates"])
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
