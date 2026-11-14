#!/usr/bin/env bash
# dream memory pass: write-memory.py through merge-approved.sh, and tend-memory.py's
# note selection and edit ops, against a throwaway knowledge base, repo and state dir.
# No model is called. `bash tests/dream-memory.sh`
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$REPO/skills/dream/scripts"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

pass=0; fail=0
ok(){ printf '  ✅ %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  ❌ %s\n' "$1"; fail=$((fail+1)); }
sha(){ python3 -c 'import hashlib,sys; print(hashlib.sha1(open(sys.argv[1],encoding="utf-8").read().encode()).hexdigest())' "$1"; }

# A knowledge base with two notes, and a repo on private/trunk carrying the scripts.
M="$T/mem"; mkdir -p "$M/tools"
printf '# A\nThe port is 8080.\n' > "$M/tools/a.md"
printf '# B\nkeep me\n' > "$M/b.md"
git -C "$M" init -q -b mac && git -C "$M" add -A && git -C "$M" commit -qm base
R="$T/repo"; mkdir -p "$R/skills/dream"
cp -R "$SCRIPTS" "$R/skills/dream/"
git -C "$R" init -q -b private/trunk && git -C "$R" add -A && git -C "$R" commit -qm base

S="$T/state"; P="$S/proposals"; mkdir -p "$P/m1.memory"
printf 'import sys\nopen("%s/outbox.log", "a").write(sys.stdin.read())\n' "$T" > "$T/outbox.py"
export DREAM_MEMORY_DIR="$M" DREAM_STATE="$S" DREAM_REPO="$R" DREAM_TIMELINE_OUTBOX="$T/outbox.py"

# m1: an approved edit computed from the current note, with a Timeline Studio task.
printf '# A\nThe port is 9090.\n' > "$P/m1.memory/0.md"
jq -n --arg s "$(sha "$M/tools/a.md")" '{id:"m1",title:"Fix the port",status:"approved",rationale:"",evidence:[],
  conflicts_with:[],rank:0,approved_at:"2026-11-08T00:00:01Z",
  memory_edits:[{path:"tools/a.md",before_sha:$s,after:"m1.memory/0.md"}],
  timeline_tasks:[{label:"Do the thing",desc:"from a note"}]}' > "$P/m1.json"
# m2: approved, but computed from an older b.md, so it must go stale and write nothing.
jq -n '{id:"m2",title:"Stale",status:"approved",rationale:"",evidence:[],conflicts_with:[],rank:0,
  approved_at:"2026-11-08T00:00:02Z",memory_edits:[{path:"b.md",before_sha:"0000",after:null}]}' > "$P/m2.json"
# s1: a session-mined note proposal in synthesize.py's NEW FILE shape.
jq -n '{id:"s1",title:"New fact",status:"approved",rationale:"",evidence:[],conflicts_with:[],rank:1,
  approved_at:"2026-11-08T00:00:03Z"}' > "$P/s1.json"
printf '## Change\n### NEW FILE: basic-memory://ollama-stall\nCreate the note (folder: infra) with:\n\n```\n# Ollama stalls\nfact\n```\n\n## How to verify it worked\nx\n' > "$P/s1.change.md"

bash "$R/skills/dream/scripts/merge-approved.sh" > "$T/out" 2>&1; rc=$?

[ "$rc" -eq 0 ]                                           && ok "merge-approved exits 0"                 || { no "merge-approved exit $rc"; cat "$T/out"; }
grep -q 'port is 9090' "$M/tools/a.md"                    && ok "m1's edit written"                      || no "m1 not written"
[ "$(jq -r .status "$P/m1.json")" = merged ]              && ok "m1 marked merged"                       || no "m1 status $(jq -r .status "$P/m1.json")"
git -C "$M" log -1 --format=%s -- tools/a.md | grep -q '^dream(m1)' && ok "m1 is its own dream() commit"  || no "no dream(m1) commit"
grep -q '"addTask"' "$T/outbox.log" 2>/dev/null            && ok "m1's Timeline Studio task sent"         || no "no task sent"
[ -f "$M/b.md" ] && grep -q 'keep me' "$M/b.md"           && ok "stale m2 wrote nothing"                 || no "m2 touched b.md"
[ "$(jq -r .status "$P/m2.json")" = stale ]               && ok "m2 marked stale"                        || no "m2 status $(jq -r .status "$P/m2.json")"
grep -qx 'fact' "$M/infra/ollama-stall.md" 2>/dev/null     && ok "s1 NEW FILE written to infra/"          || no "s1 note missing"
[ "$(jq -r .status "$P/s1.json")" = merged ]              && ok "s1 marked merged"                       || no "s1 status $(jq -r .status "$P/s1.json")"
[ "$(git -C "$R" rev-list --count private/trunk)" -eq 1 ] && ok "private/trunk not moved by note writes" || no "trunk moved"
[ -z "$(git -C "$M" status --porcelain)" ]                && ok "knowledge base left clean"              || no "uncommitted files in knowledge base"

# tend-memory.py: edit ops and note selection, called as a module.
python3 - "$SCRIPTS/tend-memory.py" > "$T/py" 2>&1 <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("tm", sys.argv[1]); tm = importlib.util.module_from_spec(spec); spec.loader.exec_module(tm)
def check(name, cond): print(("PASS " if cond else "FAIL ") + name)
f = tm.apply_edits([{"path": "b.md", "op": "append", "text": "## Relations\n- relates_to [[A]]"}])
check("append keeps the note and adds the link", f["b.md"][1].startswith("# B\nkeep me\n") and "[[A]]" in f["b.md"][1])
for bad, why in ([{"path": "b.md", "op": "replace", "find": "nope", "text": "x"}], "replace of absent text"), \
                ([{"path": "../x.md", "op": "create", "text": "x"}], "path outside the knowledge base"), \
                ([{"path": "b.md", "op": "create", "text": "x"}], "create over an existing note"):
    try: tm.apply_edits(bad); check(f"refuses {why}", False)
    except ValueError: check(f"refuses {why}", True)
check("delete yields None", tm.apply_edits([{"path": "b.md", "op": "delete"}])["b.md"][1] is None)
cur = {"a.md": "s1", "b.md": "s2", "c.md": "s3", "d.md": "s4"}
last = {"a.md": ("s1", "2026-11-01"), "b.md": ("old", "2026-11-05"), "c.md": ("s3", "2026-10-01")}
envs = [{"status": "pending", "memory_edits": [{"path": "d.md"}]}]
check("changed first, then oldest-checked, open skipped", tm.pick(list(cur), cur, last, envs, 9) == ["b.md", "c.md", "a.md"])
envs = [{"status": "denied", "memory_edits": [{"path": "c.md", "before_sha": "s3"}]}]
check("denied-and-unchanged skipped", "c.md" not in tm.pick(list(cur), cur, last, envs, 9))
check("never-checked counts as changed", tm.pick(["d.md", "a.md"], cur, last, [], 1) == ["d.md"])
check("folded YAML title read whole", tm.title_of("x.md", "---\ntitle: 'a long: title that\n  wraps here'\ntype: note\n---\n") == "a long: title that wraps here")
PY
while read -r st name; do [ "$st" = PASS ] && ok "$name" || no "$name"; done < <(grep -E '^(PASS|FAIL) ' "$T/py")
grep -qE '^(PASS|FAIL) ' "$T/py" || { no "tend-memory module check did not run"; cat "$T/py"; }

echo "dream-memory: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
