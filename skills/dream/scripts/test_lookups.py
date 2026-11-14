#!/usr/bin/env python3
"""Self-check for prefilter.lookup_signature and lookups.rows. Run: python3 scripts/test_lookups.py"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prefilter import lookup_signature as f  # noqa: E402
import lookups  # noqa: E402

assert f("Bash", {"command": "ls -la"}) is None                      # bare
assert f("Bash", {"command": "cat README.md"}) is None               # relative: a different file per project
assert f("Bash", {"command": "git log -1"}) is None                  # git state
assert f("Bash", {"command": "sed -i '' s/a/b/ /x"}) is None         # an edit, not a lookup
assert f("Bash", {"command": "gh pr list"}) is None
assert f("Bash", {"command": "cd /x && cat ~/.claude/skills/google/accounts.json | jq ."}) \
    == "Bash: cat ~/.claude/skills/google/accounts.json"
assert f("Bash", {"command": "sed -n 19,31p /a/b.md"}) == "Bash: sed -n N,Np /a/b.md"
assert f("Read", {"file_path": "/a/skills/x/SKILL.md"}) is None      # skill use, tracked elsewhere
assert f("Grep", {"pattern": "foo", "path": "/abs/src"}) == "Grep: foo in /abs/src"
assert f("WebFetch", {"url": "https://a.b/c?d=1"}) == "WebFetch: https://a.b/c"

seen = {"Bash: cat /a": {"s1": 0, "s2": 0, "s3": 0}, "Bash: cat /b": {"s1": 0, "s2": 0}}
out = lookups.rows(seen, 3, 30)
assert [r["session_id"] for r in out] == ["s1", "s2", "s3"]          # /b is under the threshold
assert len({r["uuid"] for r in out}) == 1                            # one event per session, not per call
print("ok")

# cluster.py: lookups never enter the embedding linkage; one owner = one cluster
import numpy as np  # noqa: E402
import cluster  # noqa: E402
cands = [{"kind": "friction", "text": "a"}, {"kind": "friction", "text": "b"},
         {"kind": "lookup", "text": "Bash: cat ~/.claude/skills/viz/x.md"},
         {"kind": "lookup", "text": "Bash: ls ~/.claude/skills/viz/"},
         {"kind": "lookup", "text": "Bash: cat /etc/hosts"}]
m = np.array([[1.0, 0.0], [1.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 0.0]])
lab = cluster.all_labels(cands, m, 0.24, "average")
assert lab[0] == lab[1] and lab[2] == lab[3] and len({lab[0], lab[2], lab[4]}) == 3, lab
print("cluster ok")
