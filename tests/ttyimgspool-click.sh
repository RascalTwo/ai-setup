#!/usr/bin/env bash
# The gallery in tools/ttyimgspool, driven through a real pty: clicking a
# thumbnail opens that image, a click in single view goes back, and the keyboard
# (a number + Enter, a lone Esc) still works now that mouse input is parsed.
set -uo pipefail
pass=0; fail=0
ok(){ printf '  ✅ %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  ❌ %s\n' "$1"; fail=$((fail+1)); }

here=$(cd "$(dirname "$0")/.." && pwd)
root=$(mktemp -d); trap 'rm -rf "$root"' EXIT
# 1x1 PNG; three of them, newest last so the gallery order is c, b, a
png=iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==
for n in a b c; do echo "$png" | base64 -d > "$root/$n.png"; sleep 1.1; done

# Runs the gallery at 80x40, feeds each step after a pause, prints what it drew.
drive() {
  TTYIMGSPOOL_DIR=$root python3 - "$here/tools/ttyimgspool/ttyimgspool" "$@" <<'EOF'
import fcntl, os, pty, select, struct, sys, termios, time
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 80, 0, 0))
    os.environ.pop("HERDR_ACTIVE_PANE_ID", None)
    os.execv("/bin/bash", ["bash", sys.argv[1]])
out = b""
# chafa probes the terminal and blocks until it answers, so answer like one
replies = {b"\x1b[0c": b"\x1b[?62;22c", b"\x1b[18t": b"\x1b[8;40;80t",
           b"\x1b[14t": b"\x1b[4;800;800t", b"\x1b[16t": b"\x1b[6;20;10t"}
def pump(secs):
    global out
    end = time.time() + secs
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try: got = os.read(fd, 65536)
            except OSError: return
            out += got
            for q, a in replies.items():
                if q in got: os.write(fd, a)
pump(1.5)
for step in sys.argv[2:]:
    os.write(fd, step.encode().decode("unicode_escape").encode()); pump(1.0)
print(out.decode(errors="replace"))
print(f"EXITED={os.waitpid(pid, os.WNOHANG)[0] == pid}")
EOF
}

# thumbnail 2 is grid column 1: cells x 26..47, y 3..11 (caption row included)
o=$(drive '\x1b[<0;30;5M\x1b[<0;30;5m')
grep -q '\[2/3\] b.png' <<<"$o" && ok "click on thumbnail 2 opens image 2" || no "click did not open b.png"

o=$(drive '\x1b[<0;30;11M')
grep -q '\[2/3\]' <<<"$o" && ok "the caption row counts as the thumbnail" || no "caption click missed"

o=$(drive '\x1b[<0;25;5M')
grep -q '\[[0-9]/3\]' <<<"$o" && no "gutter click opened something" || ok "click between thumbnails does nothing"

o=$(drive '\x1b[<2;30;5M')
grep -q '\[[0-9]/3\]' <<<"$o" && no "right click opened something" || ok "only a left click opens"

o=$(drive '\x1b[<0;30;5M' '\x1b[<0;10;10M')
[ "$(grep -o 'gallery — ' <<<"$o" | wc -l)" -ge 2 ] && ok "click in single view returns to the gallery" \
  || no "click in single view did not return"

o=$(drive '3\r')
grep -q '\[3/3\] a.png' <<<"$o" && ok "number + Enter still opens" || no "typed number broke"

o=$(drive '\x1b')
grep -q 'EXITED=True' <<<"$o" && ok "lone Esc still quits" || no "lone Esc did not quit"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
