#!/usr/bin/env python3
"""dream — write an APPROVED proposal's basic-memory notes. Called by merge-approved.sh.

    usage: write-memory.py <envelope.json> [--dry-run]

Two shapes of proposal reach here:
  - memory-pass proposals (tend-memory.py) carry `memory_edits`: per note, the checksum
    it was computed from and the exact after-text (null = delete).
  - session-mining proposals (synthesize.py) carry only `### NEW FILE: basic-memory://<slug>`
    sections in change.md; the note body is the section's first fenced block.

Every note is checked before anything is written: an edited note must still have the
checksum dream read, a new note must not exist yet. Any mismatch writes NOTHING and exits 3
(the proposal is stale; the next memory pass re-checks the note). Otherwise all files are
written and committed as ONE git commit in the knowledge base, so `git revert` undoes it.
Timeline Studio tasks in `timeline_tasks` go out first, through the timeline-studio outbox;
a rejected task writes nothing.

Exit: 0 written (or nothing to write), 3 stale, 1 error.
"""
import hashlib, json, os, re, subprocess, sys

MEM = os.environ.get("DREAM_MEMORY_DIR", os.path.expanduser("~/basic-memory"))
OUTBOX = os.path.expanduser(os.environ.get(
    "DREAM_TIMELINE_OUTBOX", "~/.agents/skills/timeline-studio-tasks/outbox.py"))


def sha(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()


def safe(rel: str) -> str:
    full = os.path.realpath(os.path.join(MEM, rel))
    if not full.startswith(os.path.realpath(MEM) + os.sep) or not full.endswith(".md"):
        raise ValueError(f"refusing a path outside the knowledge base: {rel}")
    return full


def from_change_md(text: str) -> list:
    """synthesize.py's NEW FILE sections -> memory_edits-shaped dicts with inline text."""
    out = []
    for m in re.finditer(r"^### NEW FILE: basic-memory://(\S+)\n(.*?)(?=^### |\Z)", text, re.M | re.S):
        slug, sec = m.group(1).strip("/"), m.group(2)
        body = re.search(r"^```[^\n]*\n(.*?)^```", sec, re.M | re.S)
        if not body:
            raise ValueError(f"basic-memory://{slug}: no fenced note body")
        folder = re.search(r"folder:\s*([\w./-]+)", sec.split("\n", 1)[0])
        rel = (f"{folder.group(1).strip('/')}/" if folder and "/" not in slug else "") + slug
        out.append({"path": rel if rel.endswith(".md") else rel + ".md", "before_sha": None, "text": body.group(1)})
    return out


def main() -> int:
    env_path, dry = sys.argv[1], "--dry-run" in sys.argv
    env = json.load(open(env_path, encoding="utf-8"))
    pdir = os.path.dirname(env_path)
    edits = env.get("memory_edits")
    if edits is None:
        change = os.path.join(pdir, f"{env['id']}.change.md")
        edits = from_change_md(open(change, encoding="utf-8").read()) if os.path.exists(change) else []

    plan = []  # (rel, full, after_text|None)
    for e in edits:
        full = safe(e["path"])
        now = open(full, encoding="utf-8").read() if os.path.exists(full) else None
        if (now is None) != (e.get("before_sha") is None) or (now is not None and sha(now) != e["before_sha"]):
            print(f"write-memory: {env['id']}: {e['path']} changed since dream read it — stale", file=sys.stderr)
            return 3
        after = e.get("text")
        if after is None and e.get("after"):
            after = open(os.path.join(pdir, e["after"]), encoding="utf-8").read()
        plan.append((e["path"], full, after))

    for rel, _, after in plan:
        print(f"write-memory: {env['id']}: {'delete' if after is None else 'write'} {rel}", file=sys.stderr)
    if dry:
        return 0
    tasks = env.get("timeline_tasks") or []
    if tasks:
        cmds = [{"type": "addTask", "task": {
            "id": f"dream-{env['id']}-{n}", "label": t["label"], "desc": t["desc"]}}
            for n, t in enumerate(tasks)]
        r = subprocess.run(["python3", "-I", OUTBOX, "send"], input=json.dumps({"cmds": cmds}),
                           capture_output=True, text=True)
        if r.returncode == 1:  # 2 = queued for later delivery, which is fine
            print(f"write-memory: timeline-studio rejected the tasks: {r.stderr.strip()[:300]}; nothing written", file=sys.stderr)
            return 1

    for rel, full, after in plan:
        if after is None:
            subprocess.run(["git", "-C", MEM, "rm", "-q", "--", rel], check=True)
        else:
            os.makedirs(os.path.dirname(full), exist_ok=True)
            open(full, "w", encoding="utf-8").write(after)
            subprocess.run(["git", "-C", MEM, "add", "--", rel], check=True)
    if plan:
        # Commit only these paths, so a concurrent basic-memory-sync cycle's files stay its own.
        subprocess.run(["git", "-C", MEM, "commit", "-q", "-m",
                        f"dream({env['id']}): {env.get('title', '')}\n\nApproved-By: human (dream viz)",
                        "--", *[r for r, _, _ in plan]], check=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        print(f"write-memory: {exc}", file=sys.stderr)
        sys.exit(1)
