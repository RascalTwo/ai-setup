#!/usr/bin/env bash
# dream apply-proposals.sh check, against a throwaway repo, state dir and a stub
# `claude`, so it never touches the real ones or calls a model. `bash tests/dream-apply.sh`
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# A repo with private/trunk and one file, and the dream scripts under test.
R="$T/repo"; mkdir -p "$R/skills/dream/scripts"
cp "$REPO/skills/dream/scripts/"{apply-proposals.sh,propose-branch.sh} "$R/skills/dream/scripts/"
echo "# rules" > "$R/AGENTS.md"
git -C "$R" init -q -b private/trunk
git -C "$R" -c user.name=t -c user.email=t@t add -A
git -C "$R" -c user.name=t -c user.email=t@t commit -qm base
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# Stub claude: appends a line to AGENTS.md in its cwd, unless the prompt says not
# to. Records its cwd, flags and DREAM_DISABLE so we can check how it was called.
mkdir -p "$T/bin"
cat > "$T/bin/claude" <<'SH'
#!/usr/bin/env bash
prompt=$(cat)
printf '%s|%s|%s\n' "$PWD" "$*" "${DREAM_DISABLE:-}" >> "$STUB_LOG"
grep -q MAKE-NO-CHANGE <<<"$prompt" && exit 0
echo "- applied by stub" >> AGENTS.md
SH
chmod +x "$T/bin/claude"
export STUB_LOG="$T/stub.log" PATH="$T/bin:$PATH"

S="$T/state"; P="$S/proposals"; mkdir -p "$P"
env_json() { printf '{"id":"%s","status":"%s","title":"%s"%s}\n' "$1" "$2" "$3" "${4:-}" > "$P/$1.json"; }
env_json p1 pending "Add a rule";       printf '### AGENTS.md\nAdd a line.\n' > "$P/p1.change.md"
env_json p2 pending "A note";           printf '### NEW FILE: basic-memory://x\nbody\n' > "$P/p2.change.md"
env_json p3 pending "Already branched" ',"branch":"dream/p3-keep"'
printf '### AGENTS.md\nx\n' > "$P/p3.change.md"
git -C "$R" branch dream/p3-keep
env_json p4 pending "Does nothing";     printf '### AGENTS.md\nMAKE-NO-CHANGE\n' > "$P/p4.change.md"
env_json p5 approved "Not pending";     printf '### AGENTS.md\nx\n' > "$P/p5.change.md"

DREAM_REPO="$R" DREAM_STATE="$S" bash "$R/skills/dream/scripts/apply-proposals.sh" > "$T/out" 2>&1
rc=$?
out="$(cat "$T/out")"

pass=0; fail=0
ok(){ printf '  ✅ %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  ❌ %s\n' "$1"; fail=$((fail+1)); }

b1=$(jq -r .branch "$P/p1.json")
[ "$rc" -eq 0 ]                                              && ok "exits 0 when one applied"          || no "exit $rc"
git -C "$R" show-ref -q --verify "refs/heads/$b1"           && ok "p1 got a dream/ branch ($b1)"      || no "p1 has no branch"
git -C "$R" show "$b1:AGENTS.md" | grep -q "applied by stub" && ok "p1's branch carries the edit"      || no "edit missing on p1 branch"
! grep -q "applied by stub" "$R/AGENTS.md"                   && ok "trunk's working tree untouched"    || no "edit leaked into trunk checkout"
[ "$(git -C "$R" rev-list --count private/trunk)" -eq 1 ]   && ok "private/trunk not moved"           || no "trunk moved"
[ "$(jq -r '.branch // empty' "$P/p2.json")" = "" ]         && ok "note-only p2 skipped, no branch"   || no "p2 got a branch"
[ "$(git -C "$R" rev-parse dream/p3-keep)" = "$(git -C "$R" rev-parse private/trunk)" ] \
                                                             && ok "existing p3 branch left alone"     || no "p3 branch changed"
b4=$(jq -r '.branch // empty' "$P/p4.json")
! git -C "$R" show-ref -q --verify "refs/heads/$b4"         && ok "failed p4's branch removed"        || no "p4 branch left behind"
[ -n "$(jq -r '.apply_error // empty' "$P/p4.json")" ]      && ok "p4 records apply_error"            || no "p4 has no apply_error"
[ "$(jq -r .status "$P/p4.json")" = pending ]               && ok "p4 stays in the queue (pending)"   || no "p4 status changed"
[ "$(wc -l < "$STUB_LOG" | tr -d ' ')" -eq 2 ]              && ok "claude called only for p1 and p4"  || no "claude called $(wc -l < "$STUB_LOG") times"
grep -q 'state/worktrees/p1|' "$STUB_LOG"                   && ok "claude ran inside p1's worktree"   || no "wrong cwd"
grep -q -- '--setting-sources' "$STUB_LOG"                 && ok "no inherited settings"             || no "--setting-sources missing"
grep -q '|1$' "$STUB_LOG"                                    && ok "DREAM_DISABLE=1 set"               || no "DREAM_DISABLE not set"
[ -z "$(git -C "$R" worktree list | grep state/worktrees)" ] && ok "no worktrees left open"           || no "worktree left open"

# Second run: p1 has its branch, p4 has apply_error, so nothing is retried.
DREAM_REPO="$R" DREAM_STATE="$S" bash "$R/skills/dream/scripts/apply-proposals.sh" >/dev/null 2>&1
[ "$(wc -l < "$STUB_LOG" | tr -d ' ')" -eq 2 ]              && ok "second run calls claude 0 times"   || no "second run re-applied"

[ "$fail" -eq 0 ] || printf '%s\n' "$out"
printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
