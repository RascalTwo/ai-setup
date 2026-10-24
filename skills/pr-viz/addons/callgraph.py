"""Generic "who calls what this PR added?" graph for a Python repo, built from a diff + ast.

Nothing here is specific to one PR. Inputs: the repo's .py sources at the PR head, and the set of
new-side line numbers the diff touches per file. Roots are functions whose `def` line the diff adds;
the graph walks up their callers to entry points.

Name resolution is by call name (`f(...)`, `obj.f(...)`), limited to the same package root, so a
same-named function in an unrelated package isn't linked. That is a heuristic: dynamic dispatch,
aliasing and getattr are not seen.
"""

import ast
import hashlib
import re
import tomllib
from collections import defaultdict

ENTRY_NAMES = {"lambda_handler", "handler", "main"}
MAX_UP = 3


def package_root(path):
    """The directory that bounds name resolution: modules/<name>/ for this layout, else the top dir."""
    parts = path.split("/")
    return "/".join(parts[:2]) if parts[0] == "modules" and len(parts) > 2 else parts[0]


def import_package(path):
    """The import package a file belongs to: <root>/src/<pkg> for a src layout, else the file's directory.

    Non-test callers only link to callees in the same import package, so a build script beside the
    package (tasks.py calling `c.run(...)`) isn't mistaken for a caller of the package's own `run`.
    """
    parts = path.split("/")
    if "src" in parts[:-1]:
        i = parts.index("src")
        return "/".join(parts[: i + 2])
    return "/".join(parts[:-1])


def module_dotted(path):
    """Dotted import path of a source file: src/<pkg>/a/b.py -> <pkg>.a.b (else the path's stem chain)."""
    parts = path.removesuffix(".py").split("/")
    if "src" in parts:
        parts = parts[parts.index("src") + 1:]
    return ".".join(parts)


def imports_module(tree, dotted):
    """Does this module's ast import `dotted` (as `from dotted import x`, `import dotted`, or `from pkg import leaf`)?"""
    pkg, _, leaf = dotted.rpartition(".")
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            mod = node.module
            if mod == dotted or mod.endswith(f".{dotted}") or (
                (mod == pkg or mod.endswith(f".{pkg}")) and any(a.name == leaf for a in node.names)
            ):
                return True
        if isinstance(node, ast.Import) and any(a.name == dotted for a in node.names):
            return True
    return False


def is_test_path(path):
    name = path.rsplit("/", 1)[-1]
    return "/tests/" in f"/{path}" or name.startswith("test_") or name == "conftest.py"


class _Index(ast.NodeVisitor):
    """Functions (with qualnames + spans) and, for each call, the enclosing function and statement."""

    def __init__(self, path, source):
        self.path, self.lines = path, source.splitlines()
        self.stack, self.stmts = [], []
        self.functions, self.calls = [], []

    def visit_ClassDef(self, node):
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()

    def _func(self, node):
        qual = ".".join([*self.stack, node.name])
        self.functions.append({"name": node.name, "qual": qual, "path": self.path, "line": node.lineno,
                               "end": node.end_lineno, "node": node})
        self.stack.append(node.name)
        self.stmts.append(None)
        self.generic_visit(node)
        self.stmts.pop()
        self.stack.pop()

    visit_FunctionDef = visit_AsyncFunctionDef = _func

    def generic_visit(self, node):
        if isinstance(node, ast.stmt) and not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            self.stmts.append(node)
            super().generic_visit(node)
            self.stmts.pop()
        else:
            super().generic_visit(node)

    def visit_Call(self, node):
        f = node.func
        name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
        if name:
            stmt = next((s for s in reversed(self.stmts) if s is not None), None)
            self.calls.append({"name": name, "path": self.path, "line": node.lineno,
                               "caller_qual": ".".join(self.stack) or "<module>",
                               "stmt": ast.unparse(stmt) if stmt is not None else ast.unparse(node),
                               "stmt_line": stmt.lineno if stmt is not None else node.lineno})
        self.generic_visit(node)


def _signature(fn):
    node = fn["node"]
    args = [f"{a.arg}: {ast.unparse(a.annotation)}" if a.annotation else a.arg for a in node.args.args]
    ret = f" -> {ast.unparse(node.returns)}" if node.returns else ""
    doc = ast.get_docstring(node) or ""
    return {"signature": f"{node.name}({', '.join(args)}){ret}", "doc": doc.strip().split("\n\n")[0]}


def _script_entries(pyprojects):
    """(package_root, function name) pairs registered as console scripts."""
    out = set()
    for path, text in pyprojects.items():
        try:
            scripts = tomllib.loads(text).get("project", {}).get("scripts", {})
        except tomllib.TOMLDecodeError:
            continue
        for target in scripts.values():
            out.add((package_root(path), target.split(":")[-1]))
    return out


def build(sources, touched_lines, pyprojects, snippet_radius=2):
    """sources: {path: text} for every .py at head. touched_lines: {path: set(new-side line numbers)}."""
    idx = {}
    for path, text in sources.items():
        try:
            tree = ast.parse(text)
        except SyntaxError:
            continue
        v = _Index(path, text)
        v.visit(tree)
        v.tree = tree
        idx[path] = v
    functions = [f for v in idx.values() for f in v.functions]
    by_key = {(f["path"], f["qual"]): f for f in functions}
    calls_by_root_name = defaultdict(list)  # (package_root, name) -> calls; filtered per callee below
    for v in idx.values():
        for c in v.calls:
            calls_by_root_name[(package_root(c["path"]), c["name"])].append(c)
    entries = _script_entries(pyprojects)

    def _test_reaches(test_path, callee_path):
        return imports_module(idx[test_path].tree, module_dotted(callee_path))

    def changed(fn):
        t = touched_lines.get(fn["path"], set())
        return any(fn["line"] <= n <= fn["end"] for n in t)

    def snippet(path, line):
        lines = idx[path].lines
        lo, hi = max(line - 1 - snippet_radius, 0), min(line + snippet_radius, len(lines))
        return {"start": lo + 1, "text": "\n".join(lines[lo:hi])}

    def is_entry(fn):
        return fn["name"] in ENTRY_NAMES or (package_root(fn["path"]), fn["name"]) in entries

    # roots: non-test functions whose def line the diff adds
    roots = [f for f in functions if not is_test_path(f["path"]) and f["line"] in touched_lines.get(f["path"], set())]

    # group identical copies (same name + same source) into one helper
    groups = defaultdict(list)
    for f in roots:
        src = ast.get_source_segment(sources[f["path"]], f["node"]) or ""
        groups[(f["name"], hashlib.sha256(src.encode()).hexdigest())].append(f)

    graphs = []
    for (name, digest), copies in groups.items():
        nodes, edges, tests = {}, [], defaultdict(set)
        helper_id = f"helper:{name}"
        nodes[helper_id] = {"id": helper_id, "kind": "helper", "name": name, "copies": [
            {"path": c["path"], "line": c["line"]} for c in copies], "sha256": digest,
            "changed": True, **_signature(copies[0])}
        outputs = []

        def node_for(fn, depth):
            nid = f"{fn['path']}::{fn['qual']}"
            if nid not in nodes:
                nodes[nid] = {"id": nid, "kind": "entry" if is_entry(fn) else "caller", "name": fn["qual"],
                              "path": fn["path"], "line": fn["line"], "changed": changed(fn), "depth": depth}
            else:
                nodes[nid]["depth"] = max(nodes[nid]["depth"], depth)
            return nid

        frontier = [(c, helper_id, 1) for c in copies]
        seen = set()
        while frontier:
            fn, target_id, depth = frontier.pop(0)
            for call in calls_by_root_name.get((package_root(fn["path"]), fn["name"]), []):
                if call["caller_qual"] == fn["qual"] and call["path"] == fn["path"]:
                    continue  # recursion
                if is_test_path(call["path"]):
                    test_name = call["caller_qual"].split(".")[-1]
                    if test_name.startswith("test_") and _test_reaches(call["path"], fn["path"]):
                        tests[call["path"]].add((test_name, fn["qual"]))
                    continue
                if import_package(call["path"]) != import_package(fn["path"]):
                    continue
                if call["caller_qual"] == "<module>":
                    cid = f"{call['path']}::<module>"
                    nodes.setdefault(cid, {"id": cid, "kind": "entry", "name": "<module>", "path": call["path"],
                                           "line": call["line"], "changed": call["line"] in touched_lines.get(call["path"], set()),
                                           "depth": depth})
                else:
                    caller = by_key.get((call["path"], call["caller_qual"]))
                    if caller is None:
                        continue
                    cid = node_for(caller, depth)
                    if (caller["path"], caller["qual"]) not in seen and depth < MAX_UP and not is_entry(caller):
                        seen.add((caller["path"], caller["qual"]))
                        frontier.append((caller, cid, depth + 1))
                edge = {"from": cid, "to": target_id, "path": call["path"], "line": call["line"],
                        "snippet": snippet(call["path"], call["line"])}
                if edge not in edges:
                    edges.append(edge)
                if target_id == helper_id:
                    outputs.append({"from": cid, "path": call["path"], "line": call["stmt_line"], "stmt": call["stmt"]})
        # tests that call an entry point directly (the walk doesn't expand entries, so collect them here)
        for n in list(nodes.values()):
            if n["kind"] != "entry" or n["name"] == "<module>":
                continue
            short = n["name"].split(".")[-1]
            for call in calls_by_root_name.get((package_root(n["path"]), short), []):
                test_name = call["caller_qual"].split(".")[-1]
                if is_test_path(call["path"]) and test_name.startswith("test_") and _test_reaches(call["path"], n["path"]):
                    tests[call["path"]].add((test_name, n["name"]))
        # nodes that stopped at MAX_UP without reaching an entry point are marked so the reader knows
        for n in nodes.values():
            if n["kind"] == "caller" and n.get("depth") == MAX_UP:
                n["truncated"] = True
        graphs.append({"helper": name, "nodes": list(nodes.values()), "edges": edges, "outputs": outputs,
                       "tests": {p: sorted(t) for p, t in sorted(tests.items())}})
    return graphs


def touched_new_lines(diff_text):
    """New-side line numbers a unified diff adds, plus the new-side position of each removal."""
    out, n = set(), None
    for line in diff_text.splitlines():
        m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if m:
            n = int(m[1])
            continue
        if n is None or line.startswith(("+++", "---")):
            continue
        if line.startswith("+"):
            out.add(n); n += 1
        elif line.startswith("-"):
            out.add(n)
        elif line.startswith(" ") or line == "":
            n += 1
    return out
