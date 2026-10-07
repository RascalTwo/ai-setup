#!/usr/bin/env bash
# The inline half of tools/ttyimgspool: show-image output makes the hook return a
# captioned placeholder grid sized to the image, and a terminal without kitty
# graphics gets nothing. Needs a controlling terminal somewhere up the process
# tree (the hook uploads to it), so run it from a real terminal or Claude Code.
set -uo pipefail
pass=0; fail=0
ok(){ printf '  ✅ %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  ❌ %s\n' "$1"; fail=$((fail+1)); }

dir=$(cd "$(dirname "$0")/../tools/ttyimgspool" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
python3 -c "import zlib,struct
def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d))
w,h=800,400; raw=b''.join(b'\0'+bytes([200,80,40])*w for _ in range(h))
open('$tmp/wide.png','wb').write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b''))"

line=$("$dir/show-image" "$tmp/wide.png")
payload=$(python3 -c 'import json,sys;print(json.dumps({"hook_event_name":"PostToolUse","tool_name":"Bash","session_id":"ttyimgspool-test","tool_input":{"command":"show-image wide.png"},"tool_response":{"stdout":sys.argv[1]}}))' "$line")

msg=$(printf '%s' "$payload" | env -u HERDR_ENV -u HERDR_PANE_ID TERM_PROGRAM=ghostty python3 "$dir/ttyimgspool-hook.py")
read -r lines caption cols <<<"$(printf '%s' "$msg" | python3 -c '
import json,sys,re
m=json.load(sys.stdin)["systemMessage"].split("\n")
print(len(m), "yes" if "show-image · 800×400 · ctrl+click to enlarge" in m[0] else "no", m[1].count("\U0010EEEE"))' 2>/dev/null)"
[ "${caption:-}" = yes ] && ok "caption names the source, size and the click" || no "caption missing or wrong: $msg"
[ "${lines:-0}" -gt 2 ] && ok "returns a placeholder grid ($((lines-1)) rows × $cols cols)" || no "no placeholder rows"

out=$(printf '%s' "$payload" | env -u HERDR_ENV -u HERDR_PANE_ID TERM_PROGRAM=Apple_Terminal TERM=xterm-256color python3 "$dir/ttyimgspool-hook.py")
[ -z "$out" ] && ok "stays silent in a terminal without kitty graphics" || no "drew in Apple Terminal"

rm -rf ~/.agents/state/ttyimgspool/ttyimgspool-test
printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
