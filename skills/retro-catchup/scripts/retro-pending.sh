#!/usr/bin/env bash
# retro-pending.sh — emit TSV of Claude Code sessions that have no retro yet.
#
# Columns: SESSION_ID<TAB>PROJECT<TAB>STARTED<TAB>MESSAGES
# Sorted by STARTED descending (most recent first).
#
# Filters out:
#   - subagent sessions (isSidechain: true on any user/assistant record)
#   - sessions with zero real turns (queue-only / empty files)
#   - sessions whose ID appears in <retro-skill>/retros/.retro-skip
#   - sessions that already have a retro file in <retro-skill>/retros/
#
# The retros directory is resolved relative to this script's real location
# (following symlinks), so the script works whether invoked from the source
# repo or via the ~/.claude/skills/retro-catchup symlink.
#
# No flags, no args. Everything is discovered from the filesystem.

set -euo pipefail

# Resolve real path so script-relative references work through symlinks.
SCRIPT_PATH="$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

PROJECTS_DIR="${HOME}/.claude/projects"
# scripts/ -> retro-catchup/ -> skills/ -> retro/retros/
RETROS_DIR="$(cd "$SCRIPT_DIR/../../retro/retros" 2>/dev/null && pwd || echo "$SCRIPT_DIR/../../retro/retros")"
SKIPLIST="${RETROS_DIR}/.retro-skip"

if [[ ! -d "$PROJECTS_DIR" ]]; then
  echo "no projects directory at $PROJECTS_DIR" >&2
  exit 0
fi

python3 - "$PROJECTS_DIR" "$RETROS_DIR" "$SKIPLIST" <<'PY'
import json, os, sys, re, signal
from pathlib import Path

# Let piping to `head` etc. exit cleanly instead of raising BrokenPipeError.
signal.signal(signal.SIGPIPE, signal.SIG_DFL)

projects_dir = Path(sys.argv[1])
retros_dir = Path(sys.argv[2])
skiplist_path = Path(sys.argv[3])

# Session IDs we've already retro'd — extracted from retro filenames.
# Filename convention: YYYY-MM-DD_HH-MM_<project>_<topic>_<session-id>.md
# session-id is a UUID (36 chars with dashes) or an 8-char prefix.
done_ids = set()
if retros_dir.is_dir():
    uuid_re = re.compile(r"([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{8})", re.I)
    for f in retros_dir.glob("*.md"):
        for m in uuid_re.findall(f.stem):
            done_ids.add(m.lower())

# User-maintained skiplist: one session ID per line, `#` comments allowed.
skip_ids = set()
if skiplist_path.is_file():
    for line in skiplist_path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            skip_ids.add(line.lower())

def already_handled(session_id: str) -> bool:
    sid = session_id.lower()
    if sid in skip_ids:
        return True
    if sid in done_ids:
        return True
    # 8-char prefix match (done_ids may contain short or full forms)
    prefix = sid[:8]
    return any(d.startswith(prefix) or prefix.startswith(d) for d in done_ids)

rows = []
for jsonl in projects_dir.glob("*/*.jsonl"):
    session_id = jsonl.stem
    if already_handled(session_id):
        continue

    is_sidechain = False
    msg_count = 0
    started = None
    cwd = None

    try:
        with jsonl.open() as fh:
            for line in fh:
                if not line.strip():
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                t = rec.get("type")
                if t in ("user", "assistant"):
                    msg_count += 1
                    if rec.get("isSidechain") is True:
                        is_sidechain = True
                    if started is None and rec.get("timestamp"):
                        started = rec["timestamp"]
                    if cwd is None and rec.get("cwd"):
                        cwd = rec["cwd"]
    except OSError:
        continue

    if is_sidechain or msg_count == 0:
        continue

    project = os.path.basename(cwd) if cwd else jsonl.parent.name
    rows.append((started or "", session_id, project, msg_count))

rows.sort(key=lambda r: r[0], reverse=True)

for started, sid, project, count in rows:
    print(f"{sid}\t{project}\t{started}\t{count}")
PY
