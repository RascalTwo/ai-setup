#!/bin/bash
# Statusline wrapper: record the account-wide rate-limit window state, then render.
#
# Usage in settings.json: "command": "…/statusline-capture.sh <your statusline command…>"
# The payload is piped to that command untouched. With no command, it only records.
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

LOG_DIR="$HOME/.agents/state/ai-tidemark/claude-code"
# Write only when a window ADVANCES — a newer resets_at, or a higher percentage
# in the same window — tracked in a per-window high-water mark. Every open session
# renders from its own stale cache, so "changed since the last line" flip-flopped
# between sessions (16/18/19% in one 30s tick) and 78% of lines were noise.
HWM="$LOG_DIR/.statusline-hwm.json"

input=$(cat)

{
  LOG="$LOG_DIR/$(date -u +%Y-%m).jsonl"
  mkdir -p "$LOG_DIR"

  # Store rate_limits verbatim. Anthropic ships codenamed buckets that are
  # null today (tangelo, cedar_ember, nimbus_quill, …); a whitelist would drop
  # them silently the day one goes live.
  cur=$(printf '%s' "$input" | jq -c '.rate_limits // empty' 2>/dev/null)
  if [ -n "$cur" ]; then
    hwm=$(cat "$HWM" 2>/dev/null); [ -n "$hwm" ] || hwm='{}'
    next=$(jq -cn --argjson c "$cur" --argjson h "$hwm" '
      reduce ($c | to_entries[] | select(.value | type == "object" and has("resets_at"))) as $e
        ({h: $h, adv: false};
         (.h[$e.key] // {resets_at: 0, used_percentage: -1}) as $o
         | if $e.value.resets_at > $o.resets_at
              or ($e.value.resets_at == $o.resets_at and $e.value.used_percentage > $o.used_percentage)
           then .h[$e.key] = $e.value | .adv = true else . end)' 2>/dev/null)
    if [ "$(printf '%s' "$next" | jq -r .adv 2>/dev/null)" = true ]; then
      ts=$(date +%Y-%m-%dT%H:%M:%S%z | sed -E 's/([0-9]{2})$/:\1/')
      rec=$(printf '%s' "$input" | jq -c --arg t "$ts" \
        '{t:$t, src:"statusline", v:.version, rate_limits:.rate_limits}' 2>/dev/null)
      # Single short append under PIPE_BUF: atomic, so concurrent sessions
      # interleave lines safely with no lock file.
      [ -n "$rec" ] && printf '%s\n' "$rec" >> "$LOG"
      printf '%s' "$next" | jq -c .h > "$HWM.$$" && mv "$HWM.$$" "$HWM"
    fi
  fi
} >/dev/null 2>&1 || true

if [ $# -gt 0 ]; then printf '%s' "$input" | "$@"; fi
