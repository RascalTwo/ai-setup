#!/usr/bin/env bash
# transcribe-media — shim. The implementation moved to transcribe.py so it can run
# on Windows too; this file stays because SKILL.md and existing callers name it.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# Pick the first candidate that actually runs, not merely the first on PATH:
# on Windows, `python3` is usually a Microsoft Store stub that exits non-zero
# with "Python was not found" instead of being absent.
py=""
for candidate in python3 python py; do
  path=$(command -v "$candidate" 2>/dev/null) || continue
  if "$path" -c '' >/dev/null 2>&1; then py=$path; break; fi
done
[ -n "$py" ] || { echo "TRANSCRIBE_FAILED python 3 not found" >&2; exit 1; }
exec "$py" "$here/transcribe.py" "$@"
