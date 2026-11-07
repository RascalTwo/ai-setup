#!/usr/bin/env python3
"""pr-viz add-on: "who calls what this change added?" for a Python repo → callgraph.json.

    python3 python_callgraph.py <repo> <range> <out-dir>

Standard library only. Reads every .py at the range's head and the diff's touched lines; the
graph logic (callgraph.py) is language-generic in shape, Python-specific in parsing — a new
language is a sibling add-on writing the same JSON.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import callgraph  # noqa: E402

repo, rng, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
head = rng.split("...")[-1].split("..")[-1]


def git(*args):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True).stdout


tree = git("ls-tree", "-r", "--name-only", head).splitlines()
skip = ("/.venv/", "/node_modules/", "/site-packages/")
sources = {p: git("show", f"{head}:{p}") for p in tree if p.endswith(".py") and not any(s in f"/{p}" for s in skip)}
pyprojects = {p: git("show", f"{head}:{p}") for p in tree if p.endswith("pyproject.toml")}
changed = [p for p in git("diff", "--name-only", rng).splitlines() if p.endswith(".py")]
touched = {p: callgraph.touched_new_lines(git("diff", "-U3", rng, "--", p)) for p in changed}
graphs = callgraph.build(sources, touched, pyprojects)
(out / "callgraph.json").write_text(json.dumps({"head": head, "graphs": graphs}, indent=1))
for g in graphs:
    print(f"callgraph {g['helper']}: {len(g['nodes'])} nodes, {len(g['edges'])} edges, "
          f"{sum(len(t) for t in g['tests'].values())} tests reach it")
