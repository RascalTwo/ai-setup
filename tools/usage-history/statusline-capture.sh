#!/bin/bash
# Statusline wrapper: record the account-wide rate-limit window state, then render.
#
# Claude Code hands the statusline a payload containing `rate_limits`, refreshed
# from its own in-memory 60s cache. That is the only place those percentages are
# exposed without a network call, and Claude Code never writes them down — so a
# window's utilisation is unrecoverable once it resets. This tees them to disk on
# the way past.
#
# Capture is fail-silent on purpose: a broken recorder must never cost you a
# statusline. Every failure path falls through to the render.
set -u

LOG_DIR="$HOME/.agents/state/usage-history/claude-code"
# Claude Code refreshes these values far less often than it renders — measured
# at ~25 min between changes, with 37 of 39 samples identical. So write on VALUE
# CHANGE, not on a timer: a timed tee produces 95% duplicates whose timestamps
# falsely imply the value was true when it was merely last known.
MIN_AGE=10   # burst guard only; the change check below does the real filtering

input=$(cat)

{
  LOG="$LOG_DIR/$(date -u +%Y-%m).jsonl"
  mkdir -p "$LOG_DIR"

  # File mtime IS the "last written" clock — both writers touch this one file,
  # so it needs no separate marker and no parsing of the last line.
  last=$(stat -f %m "$LOG" 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - last )) -ge "$MIN_AGE" ]; then
    ts=$(date +%Y-%m-%dT%H:%M:%S%z | sed -E 's/([0-9]{2})$/:\1/')
    # Store rate_limits verbatim. Anthropic ships codenamed buckets that are
    # null today (tangelo, cedar_ember, nimbus_quill, …); a whitelist would drop
    # them silently the day one goes live.
    cur=$(printf '%s' "$input" | jq -cS '.rate_limits // empty' 2>/dev/null)
    prev=$(grep '"src":"statusline"' "$LOG" 2>/dev/null | tail -1 \
           | jq -cS '.rate_limits // empty' 2>/dev/null)
    rec=""
    if [ -n "$cur" ] && [ "$cur" != "$prev" ]; then
      rec=$(printf '%s' "$input" | jq -c --arg t "$ts" \
        '{t:$t, src:"statusline", v:.version, rate_limits:.rate_limits}' 2>/dev/null)
    fi
    # Single short append under PIPE_BUF: atomic, so concurrent sessions
    # interleave lines safely with no lock file.
    [ -n "$rec" ] && printf '%s\n' "$rec" >> "$LOG"
  fi
} >/dev/null 2>&1 || true

printf '%s' "$input" | ccstatusline
