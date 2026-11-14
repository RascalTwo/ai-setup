#!/usr/bin/env python3
"""dream — the memory pass: check basic-memory notes against evidence, propose fixes.

    usage: tend-memory.py [--limit N] [--note PATH ...] [--dry-run] [--model M]

Each run checks a seventh of the notes (so every note is seen once a week): notes that
changed since their last check first, then the ones checked longest ago. One headless
`claude -p` per note reads the note, hunts evidence (files, git log, past chats through
recall, the web) and answers with a verdict. A note that needs changing becomes ONE
proposal in the dream queue; a clean note becomes one ledger row and nothing else.

Nothing here writes to the notes. A proposal carries `memory_edits` (the exact after-text
plus the checksum of the note it was computed from); merge-approved.sh writes it through
write-memory.py only after a thumbs-up, and only if the note is still what was read.

Skipped: notes with a proposal still open (one per note), and notes whose last proposal
was denied and which have not changed since. Contracts: CONTRACTS.md § Memory pass.
"""
import argparse, difflib, hashlib, json, math, os, re, signal, subprocess, sys, time

STATE = os.environ.get("DREAM_STATE", os.path.expanduser("~/.agents/state/dream"))
MEM = os.environ.get("DREAM_MEMORY_DIR", os.path.expanduser("~/basic-memory"))
REPO = os.environ.get("DREAM_REPO") or subprocess.run(
    ["git", "-C", os.path.dirname(os.path.abspath(__file__)), "rev-parse", "--show-toplevel"],
    capture_output=True, text=True).stdout.strip()
PROPOSALS = os.path.join(STATE, "proposals")
LEDGER = os.path.join(STATE, "memory", "checked.tsv")
CHECKS = os.path.join(STATE, "memory", "checks.jsonl")  # every verdict with its claims, for audit
RECALL = os.path.expanduser("~/retinue/members/recall/recall.py")
MAX_TURNS = 40
# The checker reads whatever a note names; these never leave the machine with it.
SECRETS = [f"Read({p})" for p in ("~/.ssh/**", "~/.aws/**", "~/.config/**", "~/.gnupg/**",
           "~/.netrc", "~/.atlassian-token", "//**/.env", "//**/.env.*", "//**/*token*", "//**/*secret*",
           "//**/*credential*", "//**/*.pem", "//**/*.key")]
TIMEOUT_S = 600

SYSTEM = """\
You keep Joseph's basic-memory knowledge base trustworthy. Later agent sessions read these
notes and act on them without re-checking, so a wrong note costs more than a missing one.
You are checking ONE note.

Check every claim in the note that a later session could act on: a path, a command, a
config value, a version, how a tool behaves, what was decided and why, and every status
claim (open, unmerged, pending, planned, "after X lands"): status is what drifts first. Hunt evidence for each: read the files and repos it names, `git -C <repo> log`
for what changed, past chats (`RECALL search "<what you want to know>" --store sessions -n 5
--json`), other notes in the knowledge base, and the web for vendor or version facts.
Give each claim a verdict: verified (evidence you read agrees), wrong (evidence contradicts
it), stale (it was true and the world moved), or unverifiable (no evidence either way).
Evidence is something you read in this run. Your own tool descriptions are evidence about
the Claude Code harness (it is the one the notes are about); what you already know is
evidence about nothing here. Joseph's setup is defined by his rules file (CLAUDE.md at the ai-setup root) and his skills (skills/<name>/SKILL.md there), so read
the ones a note touches. A note that contradicts them is a finding either way: one of the two
is wrong, and a later session cannot tell which. To check that a credential or secret
exists, look for the file; never read its contents.

Memory is for knowledge with nowhere better to live: an open to-do lives in Timeline Studio,
a rule every session needs lives in CLAUDE.md. It is found by search and by following links
between notes; measured, linked notes plus search answer more than search alone, so a note
that does not link the notes it relates to is half-lost. Search the knowledge base for them.

Done when every actionable claim has a verdict backed by something you read, you know which
notes this one relates to and whether it links them, and you know whether it belongs in
memory at all.

Then decide whether the note should change. What a change can be:
- fix a wrong or stale claim, saying in the note what the evidence was
- flag an unverifiable claim that matters ("> ⚠ unverified (DATE): why")
- link related notes under `## Relations` as `- relates_to [[Exact Title]]`
- merge a duplicate into the better note (edit that one, delete this one)
- delete the note when nothing in it is still true or useful
- move it where it belongs: an open to-do becomes a Timeline Studio task and the note
  shrinks to what is still knowledge, or goes
- promote a fact every session needs into CLAUDE.md (the always-loaded file, which must
  stay small), or demote a CLAUDE.md detail this note already covers to a pointer

A human reviews your change as a diff before anything is written. Propose only what you can
back with evidence you actually read, and leave every other line of the note exactly as it
is. When nothing needs to change, answer verdict "ok" with no edits.
"""

SCHEMA = {
    "type": "object",
    "required": ["verdict", "claims", "title", "rationale", "web_only", "edits", "elsewhere"],
    "properties": {
        "verdict": {"enum": ["ok", "change"]},
        "claims": {"type": "array", "items": {
            "type": "object", "required": ["claim", "verdict", "evidence"],
            "properties": {
                "claim": {"type": "string"},
                "verdict": {"enum": ["verified", "wrong", "stale", "unverifiable"]},
                "evidence": {"type": "string", "description": "what you read: path, session id, URL, command"}}}},
        "title": {"type": "string", "description": "imperative one-liner for the queue; empty when ok"},
        "rationale": {"type": "string", "description": "why, citing the evidence; empty when ok"},
        "web_only": {"type": "boolean", "description": "true when the change rests on web evidence alone"},
        "edits": {"type": "array", "description": "changes to notes, applied in order", "items": {
            "type": "object", "required": ["path", "op"],
            "properties": {
                "path": {"type": "string", "description": "note path relative to the knowledge base root"},
                "op": {"enum": ["replace", "append", "create", "delete"]},
                "find": {"type": "string", "description": "replace: exact text occurring once in the note"},
                "text": {"type": "string", "description": "replace/append/create: the new text"}}}},
        "elsewhere": {"type": "array", "items": {
            "type": "object", "required": ["target", "change"],
            "properties": {
                "target": {"type": "string", "description": "'timeline-studio' or a path in the ai-setup repo, e.g. CLAUDE.md"},
                "label": {"type": "string", "description": "timeline-studio: the task's one-line label"},
                "change": {"type": "string", "description": "the exact text to insert/replace and where; for timeline-studio, the task description"}}}},
    },
}


def sha(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()


def notes() -> list:
    out = subprocess.run(["git", "-C", MEM, "ls-files", "-z", "*.md"],
                         capture_output=True, text=True, check=True).stdout
    return sorted(p for p in out.split("\0") if p)


def ledger() -> dict:
    """path -> (sha, ts) of its newest check. Append-only; the newest row wins."""
    last = {}
    if os.path.exists(LEDGER):
        for line in open(LEDGER, encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if len(f) >= 3:
                last[f[0]] = (f[1], f[2])
    return last


def envelopes() -> list:
    out = []
    for name in os.listdir(PROPOSALS) if os.path.isdir(PROPOSALS) else []:
        if name.endswith(".json"):
            try:
                out.append(json.load(open(os.path.join(PROPOSALS, name), encoding="utf-8")))
            except (ValueError, OSError):
                pass
    return out


def pick(all_notes: list, current: dict, last: dict, envs: list, limit: int) -> list:
    """Changed-since-last-check first, then longest unchecked; skip open and denied-unchanged."""
    open_paths, denied = set(), set()
    for e in envs:
        for m in e.get("memory_edits") or []:
            if e.get("status") in ("pending", "approved"):
                open_paths.add(m.get("path"))
            elif e.get("status") == "denied":
                denied.add((m.get("path"), m.get("before_sha")))
    todo = [p for p in all_notes if p not in open_paths and (p, current[p]) not in denied]
    todo.sort(key=lambda p: (last.get(p, ("", ""))[0] == current[p], last.get(p, ("", ""))[1], p))
    return todo[:limit]


def safe_path(rel: str) -> str:
    full = os.path.realpath(os.path.join(MEM, rel))
    if not full.startswith(os.path.realpath(MEM) + os.sep) or not full.endswith(".md"):
        raise ValueError(f"edit outside the knowledge base or not a note: {rel}")
    return full


def apply_edits(edits: list) -> dict:
    """Run the model's ops on copies. Returns {path: (before_text|None, after_text|None)}."""
    files = {}
    for e in edits:
        p, op = e["path"], e["op"]
        full = safe_path(p)
        if p not in files:
            before = open(full, encoding="utf-8").read() if os.path.exists(full) else None
            files[p] = [before, before]
        cur = files[p][1]
        if op == "create":
            if cur is not None:
                raise ValueError(f"create: {p} already exists")
            files[p][1] = e.get("text", "")
        elif cur is None:
            raise ValueError(f"{op}: {p} does not exist")
        elif op == "delete":
            files[p][1] = None
        elif op == "append":
            files[p][1] = cur.rstrip("\n") + "\n" + e.get("text", "").strip("\n") + "\n"
        elif op == "replace":
            find = e.get("find") or ""
            if not find or cur.count(find) != 1:
                raise ValueError(f"replace: find text occurs {cur.count(find) if find else 0}x in {p}, need 1")
            files[p][1] = cur.replace(find, e.get("text", ""))
    return {p: tuple(v) for p, v in files.items() if v[0] != v[1]}


def udiff(path, before, after) -> str:
    return "".join(difflib.unified_diff(
        (before or "").splitlines(True), (after or "").splitlines(True),
        f"a/{path}" if before is not None else "/dev/null",
        f"b/{path}" if after is not None else "/dev/null"))


def next_id(day: str) -> str:
    seq = 0
    for name in os.listdir(PROPOSALS):
        m = re.fullmatch(rf"{day}-m(\d{{3}})\.json", name)
        if m:
            seq = max(seq, int(m.group(1)))
    return f"{day}-m{seq + 1:03d}"


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48] or "memory"


def check(path: str, text: str, titles: str, model: str) -> tuple:
    prompt = (f"Today is {time.strftime('%Y-%m-%d')}. Knowledge base root: {MEM}. "
              f"ai-setup repo (CLAUDE.md lives at its root): {REPO}.\n\n"
              f"NOTES IN THE KNOWLEDGE BASE (path | title), for links and duplicates:\n{titles}\n\n"
              f"THE NOTE TO CHECK: {path}\n<note>\n{text}\n</note>\n")
    argv = ["claude", "-p", "--model", model, "--output-format", "json",
            "--max-turns", str(MAX_TURNS),
            "--tools", "Read,Grep,Glob,Bash,WebSearch,WebFetch",
            # Read-only by construction: no Edit/Write tool, and Bash only for these.
            "--allowedTools", "Read", "Grep", "Glob", "WebSearch", "WebFetch",
            f"Bash({RECALL} search *)", "Bash(git -C * log *)", "Bash(git -C * show *)",
            "--add-dir", os.path.expanduser("~"),  # Read anywhere in home: repos, skills, configs
            "--disallowedTools", "Bash(*--output*)", *SECRETS,
            "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "",
            "--system-prompt", SYSTEM.replace("RECALL", RECALL),
            "--json-schema", json.dumps(SCHEMA)]
    env = dict(os.environ, DREAM_DISABLE="1")
    proc = subprocess.run(argv, input=prompt, env=env, cwd=MEM, timeout=TIMEOUT_S,
                          capture_output=True, text=True)
    try:
        payload = json.loads(proc.stdout)
    except ValueError:
        raise RuntimeError(f"claude exit {proc.returncode}, non-JSON: {(proc.stdout or proc.stderr)[:300]}")
    if proc.returncode or payload.get("is_error"):
        # The reason is in the JSON on stdout (synthesize.py: _one_call), not stderr.
        raise RuntimeError(f"claude exit {proc.returncode}: {payload.get('subtype')} {str(payload.get('result'))[:300]}")
    data = payload.get("structured_output")
    if not isinstance(data, dict) or data.get("verdict") not in ("ok", "change"):
        raise RuntimeError(f"no structured verdict: {str(data)[:300]}")
    return data, payload.get("total_cost_usd") or 0.0, payload.get("num_turns")


MARK = {"verified": "✅", "wrong": "❌", "stale": "⏳", "unverifiable": "❔"}


def propose(path: str, cur_sha: str, r: dict, files: dict, dry: bool, titles: set) -> str:
    day = time.strftime("%Y%m%d", time.gmtime())
    pid = next_id(day)
    title = (r.get("title") or f"Fix memory note {path}").strip()
    tasks = [{"label": x.get("label") or title, "desc": x["change"]}
             for x in r.get("elsewhere") or [] if x.get("target") == "timeline-studio"]
    other = [x for x in r.get("elsewhere") or [] if x.get("target") != "timeline-studio"]
    edits, body = [], []
    for n, (p, (before, after)) in enumerate(files.items()):
        rel = None
        if after is not None:
            rel = f"{pid}.memory/{n}.md"
            if not dry:
                os.makedirs(os.path.join(PROPOSALS, f"{pid}.memory"), exist_ok=True)
                open(os.path.join(PROPOSALS, rel), "w", encoding="utf-8").write(after)
        edits.append({"path": p, "before_sha": sha(before) if before is not None else None, "after": rel})
        body.append(f"### basic-memory://{p}\n```diff\n{udiff(p, before, after)}```\n")
    for x in other:  # CLAUDE.md promote/demote: apply-proposals.sh cuts a branch for these
        body.append(f"### {x['target']}\n{x['change'].strip()}\n")
    for t in tasks:
        body.append(f"## Timeline Studio task, created on approval\n**{t['label']}**\n\n{t['desc'].strip()}\n")
    added = {t for _, after in files.values() for t in re.findall(r"\[\[([^\]]+)\]\]", after or "")}
    before_links = {t for before, _ in files.values() for t in re.findall(r"\[\[([^\]]+)\]\]", before or "")}
    unresolved = sorted(added - before_links - titles)
    if unresolved:  # basic-memory resolves [[links]] by title; the reviewer should see a miss
        body.insert(0, "> ⚠ links that match no note title: " + "; ".join(f"[[{t}]]" for t in unresolved) + "\n")
    claims = "\n".join(f"- {MARK.get(c['verdict'], '•')} {c['claim']} — {c['evidence']}"
                       for c in r.get("claims") or [])
    env = {
        "id": pid, "title": title, "rationale": (r.get("rationale") or "").strip(),
        "evidence": [path], "occurrences": 1, "blast_radius": "single-skill", "rank": 0.0,
        "conflicts_with": [], "status": "pending",
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "memory_edits": edits, "timeline_tasks": tasks, "web_only": bool(r.get("web_only")),
        "checked_sha": cur_sha,
    }
    if other:
        env["branch"] = f"dream/{pid}-{slugify(title)}"
    change = (f"# {pid} — {title}\n\n> memory pass · note `{path}`"
              f"{' · **web evidence only**' if env['web_only'] else ''}\n\n"
              f"{env['rationale']}\n\n## Claims checked\n{claims}\n\n---\n\n## Change\n"
              + "\n".join(body))
    if dry:
        print(json.dumps(env, indent=2)); print(change)
    else:
        json.dump(env, open(os.path.join(PROPOSALS, f"{pid}.json"), "w", encoding="utf-8"), indent=2)
        open(os.path.join(PROPOSALS, f"{pid}.change.md"), "w", encoding="utf-8").write(change)
    return pid


def title_of(path: str, text: str) -> str:
    """Frontmatter title, including YAML's folded continuation lines; else the file stem."""
    m = re.search(r"^title:[ \t]*(.*)\n((?:[ \t]+\S.*\n)*)", text, re.M)
    if not m:
        return os.path.splitext(os.path.basename(path))[0]
    t = " ".join([m.group(1).strip()] + [l.strip() for l in m.group(2).splitlines()])
    return t[1:-1].replace("''", "'") if t[:1] == t[-1:] and t[:1] in "'\"" and len(t) > 1 else t


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--limit", type=int, help="notes this run (default: a seventh of them)")
    ap.add_argument("--note", action="append", help="check this note (path in the knowledge base); repeatable")
    ap.add_argument("--dry-run", action="store_true", help="print proposals; write nothing, not even the ledger")
    ap.add_argument("--model", default=os.environ.get("DREAM_MEMORY_MODEL", "sonnet"))
    a = ap.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(130))  # nightly STEP_TIMEOUT: stop between notes

    all_notes = notes()
    texts = {p: open(os.path.join(MEM, p), encoding="utf-8", errors="replace").read() for p in all_notes}
    current = {p: sha(t) for p, t in texts.items()}
    todo = a.note or pick(all_notes, current, ledger(), envelopes(), a.limit or math.ceil(len(all_notes) / 7))
    title_set = {title_of(p, texts[p]) for p in all_notes}
    titles = "\n".join(f"{p} | {title_of(p, texts[p])}" for p in all_notes)
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True); os.makedirs(PROPOSALS, exist_ok=True)

    ok = changed = failed = 0; cost = 0.0
    for path in todo:
        t0 = time.time()
        try:
            r, c, turns = check(path, texts[path], titles, a.model)
            cost += c
            verdict, pid = r["verdict"], ""
            if verdict == "change":
                files = apply_edits(r.get("edits") or [])
                if files or r.get("elsewhere"):
                    pid = propose(path, current[path], r, files, a.dry_run, title_set); changed += 1
                else:
                    verdict = "ok"
            ok += verdict == "ok"
        except (RuntimeError, ValueError, KeyError, OSError, subprocess.TimeoutExpired) as exc:
            failed += 1; verdict, pid, c, turns = "error", "", 0.0, None
            print(f"  {path}: {exc}", file=sys.stderr)
        print(f"  {verdict:6} {path} {pid} ({time.time() - t0:.0f}s, ${c:.2f}, {turns} turns)", file=sys.stderr)
        if not a.dry_run and verdict != "error":
            with open(CHECKS, "a", encoding="utf-8") as f:
                f.write(json.dumps({"path": path, "sha": current[path], "proposal": pid, "cost_usd": c,
                                    "turns": turns, "result": r}, ensure_ascii=False) + "\n")
            with open(LEDGER, "a", encoding="utf-8") as f:
                f.write(f"{path}\t{current[path]}\t{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\t{verdict}\t{pid}\n")

    print(f"tend-memory: {len(todo)} checked, {ok} ok, {changed} proposed, {failed} failed, ${cost:.2f}", file=sys.stderr)
    return 1 if todo and failed == len(todo) else 0


if __name__ == "__main__":
    sys.exit(main())
