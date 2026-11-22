#!/usr/bin/env bash
# Checks statusline-eta.sh's token for each pane state against a fake herdr: run it, expect no FAIL.
set -u
here=$(cd "$(dirname "$0")" && pwd)
dir=$(mktemp -d); trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/sessions"
cat > "$dir/herdr" <<EOF
#!/bin/sh
[ "\$2" = get ] && { printf '{"result":{"pane":{"agent_status":"%s"}}}' "\$(cat $dir/status)"; exit; }
shift 4; echo "\$*" > $dir/reported
EOF
chmod +x "$dir/herdr"
seq 60 60 6000 > "$dir/hist"   # 100 past turns: 1m, 2m, ... 100m
export HERDR_PANE_ID="w:p1" HERDR_BIN_PATH="$dir/herdr" APP_PANEL_SESSIONS="$dir/sessions" ETA_HISTORY="$dir/hist"
now=$(date +%s)
at() { date -u -r $((now - $1)) +%Y-%m-%dT%H:%M:%S.000Z; }
fails=0

# check <status> <expected token, or "none"> <case name>
check() {
  echo "$1" > "$dir/status"; rm -f "$dir/reported"
  printf '{"transcript_path":"%s"}' "$dir/t.jsonl" | "$here/statusline-eta.sh"
  for _ in $(seq 50); do [ -f "$dir/reported" ] && break; sleep 0.1; done
  got=$(grep -o -- '--token [^ ]*' "$dir/reported" 2>/dev/null | cut -d' ' -f2); got=${got:-none}
  [ "$got" = "$2" ] && echo "ok   $3: $got" || { echo "FAIL $3: got $got, want $2"; fails=$((fails + 1)); }
}
turn() {  # a finished turn, then a prompt $1 seconds ago, then an assistant line $2 seconds ago
  { echo '{"type":"user","message":{"content":"old"},"timestamp":"'"$(at 9000)"'"}'
    echo '{"type":"system","subtype":"turn_duration","durationMs":1000,"timestamp":"'"$(at 8000)"'"}'
    echo '{"type":"user","message":{"content":"go"},"timestamp":"'"$(at "$1")"'"}'
    echo '{"type":"user","message":{"content":"mid-turn nudge"},"timestamp":"'"$(at 30)"'"}'
    echo '{"type":"assistant","timestamp":"'"$(at "$2")"'"}'; } > "$dir/t.jsonl"
}

echo '{"url":"x","due":'$(( (now + 360) * 1000 ))'}' > "$dir/sessions/w_p1.json"
check working "eta_due=⏳~6m" "progress bar running"
echo '{"url":"x","due":'$(( (now - 180) * 1000 ))'}' > "$dir/sessions/w_p1.json"
check working "eta_over=⏳+3m" "progress bar overdue"
echo '{"url":"x"}' > "$dir/sessions/w_p1.json"
turn 120 10
check working "eta_g=~49m?" "guess: median of longer turns (61m) minus 2m run, timed from the first prompt"
turn 5900 10
check working "eta_g=1h38m…" "past 95% of turns: time run"
seq 60 60 600 > "$dir/hist"
check working "none" "under 30 turns of history: no guess"
turn 600 240
check blocked "eta_wait=🔔4m" "blocked: since Claude last wrote"
check idle "none" "idle"
exit "$fails"
