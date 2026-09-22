#!/bin/bash
# RTK PreToolUse adapter for Codex CLI.
# rtk emits Claude-style hook output (permissionDecisionReason, no permissionDecision).
# Codex only applies `updatedInput` when permissionDecision="allow" is present — so add it.
# Empty rtk output = no rewrite; emit nothing and let Codex run the original command.
in=$(cat)
out=$(printf '%s' "$in" | rtk hook claude)
[ -z "$out" ] && exit 0
printf '%s' "$out" | jq -c '.hookSpecificOutput.permissionDecision = "allow"' || exit 0
