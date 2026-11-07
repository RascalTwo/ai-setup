#!/usr/bin/env bash
# Open a herdr tab and launch Claude Code or Codex in it. The first prompt travels as a file
# and is expanded by the tab's own shell ("$(cat …)"), so quotes and newlines survive.
set -euo pipefail
label="" cwd="$PWD" agent=claude model="" effort="" prompt_file="" focus=--no-focus
while [ $# -gt 0 ]; do
  case $1 in
    --label) label=$2; shift ;; --cwd) cwd=$2; shift ;; --agent) agent=$2; shift ;;
    --model) model=$2; shift ;; --effort) effort=$2; shift ;; --prompt-file) prompt_file=$2; shift ;;
    --focus) focus=--focus ;;
    *) echo "spawn.sh: unknown arg $1" >&2; exit 2 ;;
  esac; shift
done
[ -n "$label" ] || { echo "spawn.sh: --label is required" >&2; exit 2; }
q() { printf '%q' "$1"; }
case $agent in
  claude) cmd="claude --dangerously-skip-permissions${model:+ --model $(q "$model")}${effort:+ --effort $(q "$effort")}" ;;
  codex)  cmd="codex${model:+ -m $(q "$model")}${effort:+ -c model_reasoning_effort=$(q "$effort")}" ;;
  *) echo "spawn.sh: --agent must be claude or codex" >&2; exit 2 ;;
esac
[ -z "$prompt_file" ] || cmd="$cmd \"\$(cat $(q "$(cd "$(dirname "$prompt_file")" && pwd)/$(basename "$prompt_file")"))\""
out=$(herdr tab create --label "$label" --cwd "$cwd" "$focus")
pane=$(printf '%s' "$out" | jq -r '.result.root_pane.pane_id')
tab=$(printf '%s' "$out" | jq -r '.result.tab.tab_id')
[ -n "$pane" ] && [ "$pane" != null ] || { echo "spawn.sh: tab create failed: $out" >&2; exit 1; }
herdr pane run "$pane" "$cmd" >/dev/null
printf '{"label":"%s","tab_id":"%s","pane_id":"%s","command":%s}\n' "$label" "$tab" "$pane" "$(jq -Rn --arg c "$cmd" '$c')"
