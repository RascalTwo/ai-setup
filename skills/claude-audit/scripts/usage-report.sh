#!/usr/bin/env bash
# usage-report.sh — Claude Code usage report from local session transcripts.
#
# Replaces the retired Prometheus/Loki/OTEL monitoring stack for claude-audit
# Phase 0. Every field comes from ~/.claude/projects/**/*.jsonl, which Claude
# Code writes unconditionally — so there is no always-on collector to keep up
# and no collection gap (the stack only had data while it was running; this
# has 6+ months of history regardless).
#
# Usage: usage-report.sh [--days N]      # default 30
#
# Perf note: this greps ~1GB of transcripts at a 30d window (~1 min). grep, not
# ripgrep: in this environment `rg` is a shell FUNCTION (routes through the
# claude binary), so a plain bash script can't reach a real rg. Patterns are
# kept as separate simple scans — a single mega-alternation is far SLOWER in
# grep because quantifier branches (`[^"]+`, `[0-9]+`) don't Aho-Corasick.
# Phase 0 should launch this in the background and read the result during the
# Phase 1 discovery step.
#
# Answers the claude-audit telemetry questions:
#   - Skill invocation counts (most / least used)   -> Phase 0, Phase 3
#   - MCP server/tool call distribution             -> Phase 0, Phase 4
#   - Tool error signal                             -> Phase 0, Phase 3/4
#   - basic-memory retrieval frequency              -> Phase 2, Phase 5
#   - Token totals                                  -> holistic
# "Least-used / dormant" = names in the Phase-1 inventory that DON'T appear
# below (zero calls in the window). The audit does that diff; this just reports
# what was actually used.

set -uo pipefail
DAYS=30
[ "${1:-}" = "--days" ] && DAYS="${2:-30}"
PROJ="$HOME/.claude/projects"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Window: `-mtime -N` is POSIX (BSD macOS + GNU), unlike GNU-only `-newermt @epoch`.
NF=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  cat "$f" >> "$TMP" 2>/dev/null
  NF=$((NF + 1))
done < <(find "$PROJ" -name '*.jsonl' -mtime -"${DAYS}" 2>/dev/null)

echo "# Claude Code usage — last ${DAYS}d  (${NF} sessions)"
[ "$NF" -eq 0 ] && { echo "No sessions in window."; exit 0; }

# Scan 1: names + skill params together (cheap 2-branch). Reduce to small lists.
NS="$(grep -hoE '"(name|skill)":"[^"]+"' "$TMP" 2>/dev/null)"
NAMES="$(printf '%s\n' "$NS" | grep '^"name"' | sed -E 's/"name":"([^"]+)"/\1/')"

echo
echo "## Skill invocations (via Skill tool)"
printf '%s\n' "$NS" | grep '^"skill"' | sed -E 's/"skill":"([^"]+)"/\1/' | sort | uniq -c | sort -rn
echo "  (skills installed but absent above = 0 calls this window)"

echo
echo "## MCP calls by server"
# Server = between mcp__ and next __. Allow UPPERCASE (claude_ai_Atlassian_Rovo, claude_ai_Context7).
printf '%s\n' "$NAMES" | grep '^mcp__' | sed -E 's/^mcp__([A-Za-z0-9_-]+)__.*/\1/' | sort | uniq -c | sort -rn
echo "  (configured servers absent above = dormant / 0 calls)"

echo
echo "## MCP calls by full tool (top 25)"
printf '%s\n' "$NAMES" | grep '^mcp__' | sort | uniq -c | sort -rn | head -25

echo
echo "## Top built-in tools (top 20)"
printf '%s\n' "$NAMES" | grep -E '^[A-Z]' | sort | uniq -c | sort -rn | head -20

echo
echo "## Error signal"
# All-literal alternation -> fast (Aho-Corasick), one scan.
grep -hoE '"is_error":true|NOOP_EDIT|TEXT_NOT_FOUND|FILE_NOT_FOUND|String not found|out of range|hash mismatch|permission denied|tool_use_error|InputValidationError|ExpiredToken|Unable to locate credentials' "$TMP" 2>/dev/null \
  | sort | uniq -c | sort -rn | sed -E 's/"is_error":true/errored tool_results (is_error:true)/'

echo
echo "## Tokens (window total)"
grep -hoE '"(input_tokens|output_tokens|cache_read_input_tokens|cache_creation_input_tokens)":[0-9]+' "$TMP" 2>/dev/null \
  | awk -F: '{gsub(/"/,"",$1); s[$1]+=$2}
             END{split("input_tokens output_tokens cache_read_input_tokens cache_creation_input_tokens",K," ");
                 for(i=1;i<=4;i++) printf "  %-30s %.0f\n", K[i], s[K[i]]+0}'
