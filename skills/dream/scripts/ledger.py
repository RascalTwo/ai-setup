#!/usr/bin/env python3
"""Read/append helpers for `$SKILL/state/processed.tsv`.

Append-only, tab-separated, no header (CONTRACTS.md):

    <session-id>\t<iso8601-utc>\t<last-uuid-seen>\t<candidate-count>\t<writer>

A session may appear many times (incremental extraction). The row with the
newest timestamp wins.

Appends are a single `os.write` to an O_APPEND fd, so concurrent writers
(nightly scan, Stop hook, SessionEnd hook) interleave whole lines and never
corrupt each other.

CLI (handy for hooks and debugging):
    ledger.py show [SESSION_ID]
    ledger.py append SESSION_ID LAST_UUID COUNT WRITER
"""

import argparse
import datetime
import os
import sys

WRITERS = ("scan", "stop-hook", "session-end-hook")
FIELDS = 5


def state_dir():
    """`~/.agents/state/dream`, or `$DREAM_STATE` when set (tests, alternate roots).

    Same variable and same default as the shell half. They used to disagree: this
    read `$DREAM_STATE_DIR`, which nothing set, and fell back to a path inside the
    repo — so the python half quietly recreated the state dir the shell half had
    stopped using.
    """
    override = os.environ.get("DREAM_STATE")
    if override:
        return os.path.abspath(override)
    return os.path.expanduser("~/.agents/state/dream")


def ledger_path():
    return os.path.join(state_dir(), "processed.tsv")


def candidates_dir():
    return os.path.join(state_dir(), "candidates")


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _rows(path=None):
    """Yield well-formed rows as dicts. Malformed lines are skipped."""
    path = path or ledger_path()
    try:
        fh = open(path, "r", encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return
    with fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) != FIELDS or not parts[0]:
                continue
            try:
                count = int(parts[3])
            except ValueError:
                count = 0
            yield {
                "session_id": parts[0],
                "ts": parts[1],
                "last_uuid": parts[2],
                "count": count,
                "writer": parts[4],
            }


def newest_by_session(path=None):
    """dict session_id -> newest row. ISO-8601-UTC sorts lexicographically."""
    newest = {}
    for row in _rows(path):
        prev = newest.get(row["session_id"])
        if prev is None or row["ts"] >= prev["ts"]:
            newest[row["session_id"]] = row
    return newest


def newest_row(session_id, path=None):
    return newest_by_session(path).get(session_id)


def last_uuid(session_id, path=None):
    """Watermark for a session, or None if it has never been processed."""
    row = newest_row(session_id, path)
    return row["last_uuid"] if row and row["last_uuid"] else None


def _clean(value):
    return str(value).replace("\t", " ").replace("\n", " ").replace("\r", " ")


def append(session_id, last_uuid_seen, count, writer, ts=None, path=None):
    """Atomically append one row. Returns the line written."""
    if writer not in WRITERS:
        raise ValueError("writer must be one of %s, got %r" % (WRITERS, writer))
    line = "%s\t%s\t%s\t%d\t%s\n" % (
        _clean(session_id),
        ts or now_iso(),
        _clean(last_uuid_seen or ""),
        int(count),
        writer,
    )
    path = path or ledger_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        os.write(fd, line.encode("utf-8"))  # one write == one atomic append
    finally:
        os.close(fd)
    return line


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    show = sub.add_parser("show", help="print newest row per session, or one session")
    show.add_argument("session_id", nargs="?")
    app = sub.add_parser("append", help="append a row")
    app.add_argument("session_id")
    app.add_argument("last_uuid")
    app.add_argument("count", type=int)
    app.add_argument("writer", choices=WRITERS)
    args = ap.parse_args(argv)

    if args.cmd == "show":
        rows = newest_by_session()
        if args.session_id:
            row = rows.get(args.session_id)
            if not row:
                return 1
            rows = {args.session_id: row}
        for sid in sorted(rows, key=lambda s: rows[s]["ts"]):
            r = rows[sid]
            print("%s\t%s\t%s\t%d\t%s" % (sid, r["ts"], r["last_uuid"], r["count"], r["writer"]))
        return 0

    sys.stdout.write(
        append(args.session_id, args.last_uuid, args.count, args.writer)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
