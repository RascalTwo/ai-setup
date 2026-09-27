#!/usr/bin/env python3
"""Stage 1 of dream capture: a deterministic, model-free FUNNEL over one transcript.

No model calls, ever. Pure stdlib. Streams the file line by line so a 54 MB
transcript never lands in memory whole; only the (small) moment list is held.

This stage NARROWS, it does not DECIDE. It favours recall over precision and
hands its output to `score.py`, which does the judging. Six measured defects in
the previous selection logic drove the rewrite:

1. Assistant turns were structurally unreachable (~83% of the corpus). They are
   now first-class: an assistant segment is admitted when it makes a
   FIRST-PERSON PAST-TENSE claim -- the grammatical shape of a self-retraction,
   an admitted error, or a disclosed mutation of the user's state. That is a
   closed grammatical class, not a topic vocabulary.
2. Selection correlated monotonically with turn length (<20 words 0%, 200+ 79%)
   because it was a keyword detector and long turns hit more keywords. There is
   now NO keyword gate on human turns at all: every substantive human turn is
   admitted, so stage-1 recall is length-independent by construction.
3. The pipeline mined its own prompts. Two independent guards: machine-driven
   sessions are dropped by the transcript's own `entrypoint`/`promptSource`
   fields, and any turn that shares long word-runs with a prompt literal found
   in this skill's own source is dropped. Neither is a literal string match, so
   both survive prompt edits.
4. A non-zero exit is not an error. A tool result must carry error SEMANTICS
   after its `Exit code N` header is removed, and a small set of known
   intent-verification probes is excluded outright.
5. Truncation decapitated instructions. `_clip` keeps the head AND the tail, so
   the operative constraint at the end of a turn survives.
6. One dictated turn holds many decisions. Long turns are split into segments
   and each is emitted as its own moment.
7. Rule 9 ("a non-zero exit is not an error") was throwing away every SUCCESSFUL
   `Task` tool_result -- the report a subagent hands back, sitting in the parent
   transcript. 24.1% of subagent assistant moments live in one. They are now
   segmented and gated exactly like assistant prose, carry an `agent_id`
   recovered from the harness's own `agentId:` footer, and are suppressed when
   that subagent's transcript is being read directly.

SUBAGENT MODE (auto-detected from the path, or forced with --subagent).
Subagent transcripts live under `<session>/subagents/` and are a different
animal: there is no human in them, so the "user" turn is a dispatch prompt
written by another agent and every user-side signal category is meaningless.
In that mode human turns are read for CONTEXT only and never emitted, the
`isSidechain` skip is suspended, moments are attributed to the PARENT session,
and Guard A is inherited from the parent transcript (a subagent's own lines
always say `entrypoint: cli`, so it cannot detect its own machine-driven-ness).

Emits one JSON object per line on stdout:

    {"session_id","uuid","ts","project","tool","role","seq","kind",
     "text","context","source"[,"agent_id"]}

`kind` here is COARSE and mechanical (`user`, `assistant`, `tool_error`,
`rejection`) -- stage 1 makes no semantic claim it cannot verify. `score.py`
assigns the final kind.

One-line JSON summary on stderr (unchanged contract, plus `pipeline`):

    {"session_id","project","last_uuid","candidates","turns",
     "lines","bad_lines","bytes","watermark_found","pipeline"}

Usage:
    prefilter.py TRANSCRIPT.jsonl [--since-uuid UUID] [--session-id ID]
                                  [--project SLUG]
"""

import argparse
import ast
import json
import os
import re
import sys
from collections import OrderedDict

TOOL = "claude-code"
SOURCE = "prefilter"
MAX_TEXT = 2000
MAX_CONTEXT = 1000
MIN_WORDS = 3

# Segment granularity (defect 6, sharpened by defect 7 below). A segment is the
# unit the stage-2 judge sees, so it has to be about the size of ONE stance: this
# user dictates, flips stance mid-turn, and buries a 4-word objection inside 50
# words of briefing. Sentences are packed until the segment reaches TARGET, then
# flushed; HARD_MAX bounds a run-on that never punctuates.
SEGMENT_TARGET_WORDS = 15
SEGMENT_MAX_WORDS = 40
# Raised from 12 with the target: the cap is meant to bound a pathological turn,
# not a normal one, and at 15 words a cap of 12 would start decapitating the
# middle of any turn over ~180 words -- exactly the dictated turns defect 6 is
# about. 48 x 15 keeps the same ~700-word reach the old 12 x 60 had, and costs
# 13% more user moments than 12 on the gold set (2,853 -> 3,228).
MAX_SEGMENTS = 48

# The assistant gate (SELF_REPORT, defect 1) still runs on a paragraph-sized
# window: the first-person past-tense trigger and the admission it introduces are
# often in different sentences ("I checked X ... your audit skill has a blind
# spot"), so gating each sentence separately throws the admission away. The
# window decides ADMISSION; the segments inside it are what gets judged.
ASSISTANT_WINDOW_WORDS = 60

# Only these line types carry signal. Everything else (file-history-snapshot,
# file-history-delta, mode, permission-mode, last-prompt, attachment, ai-title,
# system, queue-operation, ...) is dropped.
KEEP_TYPES = ("user", "assistant")

# Markers Claude Code writes verbatim when a tool call is denied or interrupted.
DENIED = "doesn't want to proceed with this tool use"
INTERRUPTED = "[Request interrupted by user"

# Harness scaffolding that arrives on a `user` line but no human typed it.
_HARNESS_TAGS = (
    "system-reminder",
    "command-name",
    "command-message",
    "command-args",
    "local-command-caveat",
    "local-command-stdout",
    "local-command-stderr",
    "task-notification",
    "bash-input",
    "bash-stdout",
    "bash-stderr",
)
_STRIP = re.compile(
    "|".join(r"<%s>.*?</%s>" % (t, t) for t in _HARNESS_TAGS)
    + r"|\[Image[^\]]*\]",
    re.S,
)

# Fenced code and diff hunks are not narration. Removed from assistant text
# before segmentation so a stack trace pasted into an explanation cannot fake
# the self-report gate.
_FENCE = re.compile(r"```.*?```|~~~.*?~~~", re.S)


# --------------------------------------------------------------- Task reports
# A successful `Task` tool_result is the REPORT a subagent hands back when it
# finishes, sitting in the PARENT transcript. Rule 9 keeps a tool_result only
# when it carries error semantics, so until 2026-08-16 every one of these was
# opened and thrown away -- and a subagent report is exactly where "I was
# wrong", "my check was weak", "I over-deleted" live. Measured on the
# subagent-capture study: 24.1% of subagent assistant moments already sit
# inside one of these blocks.
#
# It is a report, not a turn: long, structured markdown with headings, tables
# and bullet lists. Emitting it whole would be one enormous low-signal moment,
# so it gets the same treatment as any other assistant prose -- fences
# stripped, packed into ASSISTANT_WINDOW_WORDS windows, admitted only through
# SELF_REPORT.
#
# Claude Code appends a trailing meta block naming the agent that produced it:
#     agentId: ae4256861f9f982b8 (for resuming ...)
#     <usage>total_tokens: ...</usage>
# `agent-<agentId>` is exactly the stem of that agent's own transcript under
# `<session>/subagents/`, which is what makes the de-duplication below exact
# rather than a text-similarity guess.
# THE TOOL HAS TWO NAMES. Measured over the whole corpus 2026-08-16: `Agent`
# 3,010 results, `Task` 34. The subagent-capture study called it "Task", which
# is what the tool was called until early 2026; matching only that name finds
# 34 dispatches in 5,013 sessions and yields 16 moments. Both names, always.
DISPATCH_TOOLS = ("Task", "Agent")

_AGENT_META = re.compile(r"\n*^agentId:\s*([0-9a-fA-F]+)\b.*\Z", re.S | re.M)
_USAGE = re.compile(r"<usage>.*?</usage>", re.S)

# Not every dispatch result is a report. An ASYNC dispatch returns launch
# metadata (the agent is still running; its report arrives later, in a
# `<task-notification>`), and a team spawn returns a mailbox handle. Measured:
# 718 of 3,044 dispatch results are one of these. They are pure harness
# bookkeeping AND they contain imperative text addressed to the agent
# ("Do NOT Read or tail this file..."), which has no business in the funnel.
_LAUNCH_ONLY = ("Async agent launched", "Spawned successfully")


# --------------------------------------------------------------- defect 3
# Self-ingestion guards.
#
# Guard A is structural: `claude -p` / SDK sessions stamp every line with
# `entrypoint: sdk-cli|sdk-ts` and every prompt with `promptSource: sdk`.
# Measured over a 400-session sample of ~/.claude/projects: 19 sdk sessions, and
# every human session was `typed`/absent. Any prompt this pipeline issues is
# therefore excluded before it is ever read, and that stays true when the prompt
# text changes.
#
# Guard B is a fallback for transcripts predating those fields, or for a
# pipeline prompt pasted into a human session: fingerprint the long string
# literals in this skill's own source and reject any turn that shares whole
# word-runs with them. Derived from the source at run time, so editing a prompt
# updates the fingerprint automatically.

SDK_PROMPT_SOURCES = ("sdk",)
_MACHINE_PROBE_LINES = 40
_SHINGLE_N = 8
_MIN_LITERAL_CHARS = 120
_SHINGLE_HITS_NEEDED = 3
_TRIPLE_QUOTED = re.compile(r'"""(.*?)"""|\'\'\'(.*?)\'\'\'', re.S)
_pipeline_shingles_cache = None


def _words(text):
    return re.findall(r"[a-z0-9']+", text.lower())


def _shingles(text, n=_SHINGLE_N):
    w = _words(text)
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


def _skill_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def pipeline_shingles():
    """Word n-grams of every long string literal in this skill's own code.

    Cheap (a few hundred KB of source, parsed once) and self-maintaining: a new
    prompt in `score.py` or a reworded one in `synthesize.py` is picked up on the
    next run with no list to keep in sync.

    TRAP, hit for real on 2026-08-16: this reads DOCSTRINGS AND COMMENTS too, so
    quoting a transcript verbatim in this skill's source blacklists the human turn
    it came from. A docstring here that reproduced ~25 words of a real dictated
    turn silently deleted that turn from the funnel -- and it was a gold moment.
    Never paste more than a few words of a real turn into this repo's Python;
    paraphrase, or break the quote up.
    """
    global _pipeline_shingles_cache
    if _pipeline_shingles_cache is not None:
        return _pipeline_shingles_cache

    out = set()
    root = _skill_root()
    for sub in ("scripts", "hooks", "eval"):
        d = os.path.join(root, sub)
        try:
            names = sorted(os.listdir(d))
        except OSError:
            continue
        for name in names:
            path = os.path.join(d, name)
            if not os.path.isfile(path):
                continue
            try:
                with open(path, encoding="utf-8", errors="replace") as fh:
                    src = fh.read()
            except OSError:
                continue
            literals = []
            if name.endswith(".py"):
                try:
                    for node in ast.walk(ast.parse(src)):
                        if isinstance(node, ast.Constant) and isinstance(node.value, str):
                            literals.append(node.value)
                except SyntaxError:
                    pass
            elif name.endswith(".sh"):
                # Shell hooks embed their prompts in triple-quoted heredoc Python.
                literals = [a or b for a, b in _TRIPLE_QUOTED.findall(src)]
            for lit in literals:
                if len(lit) >= _MIN_LITERAL_CHARS:
                    out |= _shingles(lit)
    _pipeline_shingles_cache = out
    return out


# --------------------------------------------------------------- subagents
# A subagent transcript lives at
#     <projects>/<slug>/<parent-session-id>/subagents/[workflows/wf_*/]<name>.jsonl
# and is segregated by PATH, not by field. Three properties matter and all three
# are measured, not assumed (4,054 files, 2026-08-16):
#
#   * `sessionId` inside the file is the PARENT's id, not the subagent's. Naming
#     a moment by the file stem would invent a session that does not exist, and
#     keying the ledger on `sessionId` would make every subagent of one parent
#     collide with the parent and with each other.
#   * `isSidechain` is true on 4,027/4,027 message lines, so the normal
#     "skip sidechains" rule has to be suspended deliberately, per file.
#   * `entrypoint` is `cli` (3,034) or absent (979); `promptSource` is set on
#     ZERO of them. Guard A therefore CANNOT fire on a subagent's own lines --
#     the machine-driven signal lives only in the parent transcript, so it has
#     to be inherited from there. See `is_machine_driven`.

SUBAGENT_DIR = "subagents"


def subagent_ids(path):
    """`(project-slug, parent-session-id)` for a subagent transcript, else None.

    Also the detector: a file is a subagent transcript iff it sits under a
    `subagents/` directory. Path-based, matching how Claude Code segregates them.
    """
    parts = os.path.abspath(path).split(os.sep)
    try:
        i = parts.index(SUBAGENT_DIR)
    except ValueError:
        return None
    if i < 2:
        return None
    return parts[i - 2], parts[i - 1]


def subagent_key(path):
    """Ledger key for a subagent transcript: `<parent-session-id>/<rel-path>`.

    NOT the file stem: 7 of 659 parents reuse a stem across `workflows/` dirs
    (`journal.jsonl` twice), so a stem key would silently merge two subagents
    into one watermark and drop the second one's moments forever.
    """
    parts = os.path.abspath(path).split(os.sep)
    i = parts.index(SUBAGENT_DIR)
    rel = "/".join(parts[i:])
    return "%s/%s" % (parts[i - 1], os.path.splitext(rel)[0])


def session_dir(path):
    """The `<slug>/<session>` directory whose `subagents/` tree belongs to `path`.

    Works for a top-level transcript (`<session>.jsonl` -> `<session>/`) and for
    anything already inside a `subagents/` tree.
    """
    parts = os.path.abspath(path).split(os.sep)
    try:
        return os.sep.join(parts[:parts.index(SUBAGENT_DIR)])
    except ValueError:
        return os.path.splitext(os.path.abspath(path))[0]


def parent_transcript(path):
    """Path of the top-level session that spawned this subagent, or None."""
    parts = os.path.abspath(path).split(os.sep)
    try:
        i = parts.index(SUBAGENT_DIR)
    except ValueError:
        return None
    return os.sep.join(parts[:i]) + ".jsonl"


def is_machine_driven(path, probe=_MACHINE_PROBE_LINES):
    """Guard A as a head-probe: does this transcript carry the SDK markers?

    Used to inherit the verdict onto subagents, whose own lines never carry it.
    """
    try:
        fh = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return False
    with fh:
        for i, line in enumerate(fh):
            if i >= probe:
                break
            try:
                obj = json.loads(line)
            except (ValueError, TypeError):
                continue
            if not isinstance(obj, dict):
                continue
            if str(obj.get("entrypoint") or "").startswith("sdk"):
                return True
            if obj.get("promptSource") in SDK_PROMPT_SOURCES:
                return True
    return False


def is_pipeline_text(text):
    """True if `text` reproduces this pipeline's own prompt/output wording."""
    if len(text) < _MIN_LITERAL_CHARS:
        return False
    known = pipeline_shingles()
    if not known:
        return False
    hits = 0
    for sh in _shingles(text):
        if sh in known:
            hits += 1
            if hits >= _SHINGLE_HITS_NEEDED:
                return True
    return False


# --------------------------------------------------------------- defect 1
# An assistant segment is admitted when a first-person subject is followed,
# within the same sentence, by a past-tense verb. That is the grammatical shape
# of "I corrupted the file", "my `| tail -1` masked the exit code", "I've been
# guessing and I was wrong four times", "I switched it to List and left it
# there" -- self-retraction, admitted error, disclosed mutation of user state.
# Regular past tense is `\w+ed`; the irregulars below are a closed class of
# English, not a topic vocabulary, so this does not rot the way a keyword list
# does. Measured on the 96 audited sessions: admits 24% of assistant turns and
# catches every self-retraction the auditors named.
_IRREGULAR_PAST = (
    "was|were|had|did|got|went|broke|wrote|made|took|left|lost|missed|forgot|"
    "said|told|thought|knew|saw|found|ran|came|gave|kept|meant|sent|spent|"
    "built|caught|hit|held|read|blew|drew|fell|felt|hid|let|paid|put|set|shot|"
    "shut|sat|slept|sold|stood|struck|swept|threw|understood|won|chose|began|"
    "bought|brought|dealt|drove|ate|flew|froze|grew|led|met|rose|sank|spoke|"
    "stuck|swore|tore|wore|hung|dug|fed|bled|burnt|crept|clung|leapt|meant"
)
# re.I is load-bearing: without it `\bmy\b` matches only lowercase, so a
# sentence-initial "My ..." never matches — and "My earlier claim was wrong" is
# the single commonest shape of an assistant self-retraction. Measured against
# the recall audit's gold set, adding it lifts assistant stage-1 recall from
# 81.5% to 92.6% and recovers 3 of the 5 remaining misses.
SELF_REPORT = re.compile(
    r"(?:\bI\b|\bI'(?:ve|d|m)\b|\bmy\b)[^.!?\n]{0,160}?\b(?:\w+ed|%s)\b"
    % _IRREGULAR_PAST,
    re.I,
)


# --------------------------------------------------------------- defect 4
# A non-zero exit is not an error. `ls` probing for a path, a grep with no
# match, and `fatal: no upstream configured` (the intended state, being
# verified) all exit non-zero and all succeeded. Require error SEMANTICS in
# what is left after the `Exit code N` header, and drop known probes outright.
_EXIT_HEADER = re.compile(r"\A\s*Exit code \d+\s*", re.I)
ERROR_SEMANTICS = re.compile(
    r"<tool_use_error>|Traceback \(most recent call last\)"
    r"|\b\w*(?:Error|Exception)\b|\berror\b|\bfatal\b|\bpanic\b"
    r"|command not found|not recognized|No such file or directory"
    r"|permission denied|\bdenied\b|\bunauthorized\b|\bforbidden\b"
    r"|\brefused\b|\bfail(?:ed|ure|s)?\b|\bcannot\b|\bcan'?t\b|\bunable to\b"
    r"|timed out|\btimeout\b|\bnot found\b|\bmissing\b|\binvalid\b"
    r"|\bblocked\b|\babort(?:ed)?\b|\bcrash(?:ed)?\b|\bcorrupt",
    re.I,
)
BENIGN_PROBE = re.compile(
    r"no upstream configured for branch"
    r"|nothing to commit"
    r"|^\s*No matches found\s*$"
    r"|^\s*no matches found\s*$",
    re.I | re.M,
)


def tool_error_body(body, is_error):
    """Return the diagnostic text of a failed tool result, or None if it was not
    an error at all. `is_error` alone is not evidence."""
    if not body:
        return None
    if not is_error and "<tool_use_error>" not in body:
        return None
    rest = _EXIT_HEADER.sub("", body).strip()
    if not rest:
        return None                      # bare "Exit code 1": no semantics
    if BENIGN_PROBE.search(rest):
        return None                      # the failure WAS the expected answer
    if not ERROR_SEMANTICS.search(rest):
        return None
    return rest


def task_report(body):
    """Split a Task tool_result into `(report_text, agent_id)`.

    `agent_id` is `agent-<hex>`, the stem of that subagent's own transcript, or
    "" when the harness wrote no meta block (older transcripts). The meta block
    and the `<usage>` accounting are stripped: they are machine bookkeeping and
    would otherwise be segmented and judged like prose.
    """
    if not body or body.startswith(_LAUNCH_ONLY):
        return "", ""
    m = _AGENT_META.search(body)
    agent = "agent-" + m.group(1) if m else ""
    text = _AGENT_META.sub("", body)
    return _USAGE.sub(" ", text).strip(), agent


_captured_cache = {}


def captured_agents(path):
    """Stems of every subagent transcript `scan.py --subagents` reads for this session.

    Keyed on the session directory, not on `path`'s own directory: a subagent
    can dispatch its own subagents, and the grandchild's transcript is filed
    under the SESSION's `subagents/` tree (sometimes several levels down under
    `workflows/`), not beside its dispatcher. Checking only the sibling path
    missed 474 of 737 already-captured reports -- more than it caught.

    Memoised per session directory; `~/.claude/projects` is read-only input for
    the length of a run, so one walk is enough.
    """
    root = os.path.join(session_dir(path), SUBAGENT_DIR)
    if root not in _captured_cache:
        out = set()
        for _dirpath, _dirnames, files in os.walk(root):
            out.update(n[:-len(".jsonl")] for n in files if n.endswith(".jsonl"))
        _captured_cache[root] = out
    return _captured_cache[root]


# --------------------------------------------------------------- helpers

def _norm_ts(raw):
    """`2026-04-10T16:00:16.346Z` -> `2026-04-10T16:00:16Z` (contract format)."""
    if not isinstance(raw, str) or not raw:
        return ""
    head = raw.split(".", 1)[0].split("+", 1)[0].rstrip("Z")
    return head + "Z"


def _blocks(content):
    """Normalize message.content (str | list) to a list of dict blocks."""
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if isinstance(content, list):
        return [b for b in content if isinstance(b, dict)]
    return []


def _flatten(value):
    """tool_result content: str | list of blocks | anything -> plain text."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for b in value:
            if isinstance(b, dict):
                parts.append(b.get("text") or b.get("content") or "")
            elif isinstance(b, str):
                parts.append(b)
        return "\n".join(p for p in parts if isinstance(p, str))
    if value is None:
        return ""
    return json.dumps(value)[:MAX_TEXT]


def _clean(text):
    return _STRIP.sub(" ", text).strip()


def _clip(text, limit):
    """Truncate keeping BOTH ends (defect 5).

    The old code cut at a fixed prefix, which reliably kept the preamble and
    dropped the constraint -- "make it green or lime, no purple, no blue" became
    "make it". The operative content of an instruction is at the end far more
    often than at the start, so the tail gets the larger share.
    """
    if text is None:
        return ""
    if len(text) <= limit:
        return text
    marker = "\n[... %d chars elided ...]\n"
    keep = max(limit - len(marker % len(text)), 8)   # upper bound on the marker
    head = keep // 3
    tail = keep - head
    # rstrip/lstrip only shorten, so the result can never exceed `limit`.
    return text[:head].rstrip() + (marker % (len(text) - keep)) + text[-tail:].lstrip()


clip = _clip          # score.py clips moment text the same way; one definition only.


_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")


def segments(text, target=None, hard_max=None):
    """Split a turn into judging units at SENTENCE boundaries. Short turns stay whole.

    DEFECT 7 (measured 2026-08-16 on the 42-session gold set). The old budget
    packed sentences up to 60 words and only split turns over 70, which made the
    unit a paragraph. 10 of the 12 gold moments the judge discarded were a 4-10
    word objection inside a 28-59 word segment that was otherwise briefing,
    narration or praise: a turn that opens with praise, concedes a bug in one
    clause, and closes with the next instruction reads as non-friction when the
    judge sees it as one block. Re-judging the same moments cut to their own
    sentences lifted the keep rate from 22% to 50% in a controlled A/B (3 reps,
    sonnet, mixed 25-moment batches).

    Packing is to a MINIMUM, not a maximum: sentences accumulate until the
    segment reaches `target`, then it is flushed. That keeps one-word sentences
    ("Awesome.") from becoming their own moment without letting a segment grow
    back to paragraph size. `hard_max` bounds a dictated run-on that never
    punctuates -- the only case the old word-count chop still handles.
    """
    target = SEGMENT_TARGET_WORDS if target is None else target
    hard_max = SEGMENT_MAX_WORDS if hard_max is None else hard_max
    text = text.strip()
    if not text:
        return []
    if len(text.split()) <= target:
        return [text]

    pieces = []
    for sentence in _SENTENCE.split(text):
        sentence = sentence.strip()
        if not sentence:
            continue
        words = sentence.split()
        if len(words) > hard_max:
            for i in range(0, len(words), hard_max):
                pieces.append(" ".join(words[i:i + hard_max]))
        else:
            pieces.append(sentence)

    out, cur, n = [], [], 0
    for piece in pieces:
        w = len(piece.split())
        if cur and (n >= target or n + w > hard_max):
            out.append(" ".join(cur))
            cur, n = [], 0
        cur.append(piece)
        n += w
    if cur:
        out.append(" ".join(cur))
    if len(out) > MAX_SEGMENTS:
        # Keep the ends: an over-long turn opens with context and closes with
        # the actual ask. The middle is the narration.
        head = MAX_SEGMENTS // 2
        out = out[:head] + out[len(out) - (MAX_SEGMENTS - head):]
    return out


# --------------------------------------------------------------- extraction

def extract(path, since_uuid=None, session_id=None, project=None, subagent=None,
            task_reports=True, skip_captured_agents=False):
    """Stream `path`, returning (moments, summary).

    `since_uuid` is a watermark: only moments strictly after that message uuid
    are returned. If the watermark uuid is not present in the file (rotated or
    rewritten transcript) everything is returned and `watermark_found` is False.

    `subagent` selects subagent mode (default: auto-detected from the path).
    In that mode there is NO HUMAN in the file -- the "user" turn is a dispatch
    prompt written by another agent -- so every user-side signal category is
    meaningless or actively misleading. Human turns are read for CONTEXT only
    and never emitted. Assistant and tool-result moments are unchanged.

    `task_reports` mines successful `Task` tool_results -- a subagent's closing
    report, already streaming past in the parent transcript.
    `skip_captured_agents` drops the ones whose subagent transcript exists on
    disk, because `scan.py --subagents` reads that file directly and the report
    is a strict subset of it. Set it from the same flag.
    """
    path = os.path.abspath(path)
    ids = subagent_ids(path)
    if subagent is None:
        subagent = ids is not None

    agent_id = ""
    pipeline = False
    if subagent:
        agent_id = os.path.splitext(os.path.basename(path))[0]
        if ids:
            project = project or ids[0]
            # The parent session, not the file stem: a subagent's lesson belongs
            # to the work that spawned it, or it clusters as an isolated one-off.
            session_id = session_id or ids[1]
        parent = parent_transcript(path)
        # Guard A, inherited. A subagent of a machine-driven session is itself
        # machine-driven, but says `entrypoint: cli` on every one of its own
        # lines -- so without this the pipeline would mine subagents it had
        # dispatched itself.
        if parent and is_machine_driven(parent):
            pipeline = True

    session_id = session_id or os.path.splitext(os.path.basename(path))[0]
    project = project or os.path.basename(os.path.dirname(path))

    candidates = []          # (seen_watermark_at_emit_time, record)
    watermark_found = False
    last_uuid = ""
    lines = bad = turns = 0
    tool_uses = OrderedDict()  # tool_use_id -> short description
    last_assistant_text = ""
    last_user_text = ""

    def add(uuid, ts, role, kind, text, context="", seq=0, agent=None):
        rec = {
            "session_id": session_id,
            "uuid": uuid,
            "ts": ts,
            "project": project,
            "tool": TOOL,
            "role": role,
            "seq": seq,
            "kind": kind,
            "text": _clip(text, MAX_TEXT),
            "context": _clip(context, MAX_CONTEXT),
            "source": SOURCE,
        }
        who = agent_id if agent is None else agent
        if who:
            # Only present on subagent moments (a subagent transcript, or a
            # subagent's Task report lifted out of its parent), so top-level
            # output stays byte-identical for every existing consumer.
            rec["agent_id"] = who
        candidates.append((watermark_found, rec))

    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            lines += 1
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except (ValueError, TypeError):
                bad += 1          # truncated tail or corrupt line: skip it
                continue
            if not isinstance(obj, dict):
                bad += 1
                continue
            if obj.get("type") not in KEEP_TYPES:
                continue
            if obj.get("isSidechain") is True and not subagent:
                continue

            uuid = obj.get("uuid") or ""
            if uuid:
                last_uuid = uuid

            # Guard A. A machine drove this session, so nothing in it is a human
            # friction moment -- including this pipeline's own prompts. Keep
            # reading only to carry the watermark forward.
            if (
                str(obj.get("entrypoint") or "").startswith("sdk")
                or obj.get("promptSource") in SDK_PROMPT_SOURCES
            ):
                pipeline = True
                candidates = []
            if pipeline:
                continue

            if since_uuid and uuid == since_uuid:
                watermark_found = True
                continue

            message = obj.get("message")
            if not isinstance(message, dict):
                continue
            ts = _norm_ts(obj.get("timestamp"))
            blocks = _blocks(message.get("content"))
            if not blocks:
                continue
            turns += 1

            # ------------------------------------------------ assistant turn
            if obj["type"] == "assistant":
                text_parts = []
                for b in blocks:
                    if b.get("type") == "text" and isinstance(b.get("text"), str):
                        text_parts.append(b["text"])
                    elif b.get("type") == "tool_use":
                        desc = str(b.get("name", "tool"))
                        args = b.get("input")
                        if isinstance(args, dict) and args:
                            desc += " " + _clip(json.dumps(args), 600)
                        tool_uses[str(b.get("id"))] = desc
                        while len(tool_uses) > 500:
                            tool_uses.popitem(last=False)
                if not text_parts:
                    continue
                whole = "\n".join(text_parts)
                last_assistant_text = whole
                narration = _clean(_FENCE.sub(" ", whole))
                if not narration or is_pipeline_text(narration):
                    continue
                # Assistant text keeps the PARAGRAPH window, deliberately. Defect
                # 7 is a dictation defect: it is the human who flips stance
                # mid-turn. Two things measured on the 42 gold sessions say not
                # to cut assistant prose the same way:
                #   * the SELF_REPORT trigger and the admission it introduces sit
                #     in different sentences (the model says what it checked in
                #     one sentence and names the flaw in the next), so a
                #     per-sentence gate keeps the boilerplate and drops the
                #     admission -- 11 points of assistant stage-1 gold recall.
                #   * gating on the window and then cutting it finer costs 2.4x
                #     the assistant moments (2,117 -> 5,142) and did not rescue
                #     the one assistant moment dilution was suspected of losing,
                #     which sits in a 40-word markdown sentence a sentence
                #     splitter cannot cut anyway.
                seq = 0
                # target == hard_max makes the packing MAX-fill again, which is
                # what this path had before defect 7 and still wants.
                for seg in segments(narration, ASSISTANT_WINDOW_WORDS,
                                    ASSISTANT_WINDOW_WORDS):
                    if SELF_REPORT.search(seg):
                        add(uuid, ts, "assistant", "assistant", seg,
                            last_user_text, seq)
                        seq += 1
                continue

            # ------------------------------------------------ user line
            # Either real human turn(s) or the results of the assistant's tools.
            human_parts = []
            # `(uuid, seq)` is the moment key and cluster.py dedupes on it, so one
            # counter has to span every tool_result in the message: parallel Task
            # dispatches come back as several blocks under a single uuid, and a
            # fixed seq=0 would let cluster.py drop all but the first.
            tseq = 0
            for b in blocks:
                btype = b.get("type")
                if btype == "tool_result":
                    body = _flatten(b.get("content"))
                    context = tool_uses.get(str(b.get("tool_use_id")), "")
                    if DENIED in body or INTERRUPTED in body:
                        add(uuid, ts, "tool", "rejection", body, context, tseq)
                        tseq += 1
                        continue
                    diagnostic = tool_error_body(body, b.get("is_error") is True)
                    if diagnostic:
                        add(uuid, ts, "tool", "tool_error", diagnostic, context, tseq)
                        tseq += 1
                        continue
                    # A successful dispatch result is a subagent's closing
                    # report. Tool names never contain a space, so the first
                    # token of the recorded description is the tool name.
                    if task_reports and context.split(" ", 1)[0] in DISPATCH_TOOLS:
                        report, agent = task_report(body)
                        if skip_captured_agents and agent and \
                                agent in captured_agents(path):
                            continue          # mined from its own transcript
                        narration = _clean(_FENCE.sub(" ", report))
                        # Guard B on BOTH halves. The report is the only place a
                        # dispatch prompt is recorded next to its output, so a
                        # subagent this pipeline dispatched is caught by its
                        # brief even when the report itself paraphrases.
                        if not narration or is_pipeline_text(narration) \
                                or is_pipeline_text(context):
                            continue
                        agent = agent or "task-" + str(b.get("tool_use_id") or uuid)
                        for seg in segments(narration, ASSISTANT_WINDOW_WORDS,
                                            ASSISTANT_WINDOW_WORDS):
                            if SELF_REPORT.search(seg):
                                add(uuid, ts, "assistant", "assistant", seg,
                                    context, tseq, agent)
                                tseq += 1
                elif btype == "text" and isinstance(b.get("text"), str):
                    human_parts.append(b["text"])

            if not human_parts:
                continue
            # Substance gate: isMeta turns and sub-3-word turns are not signal.
            if obj.get("isMeta") is True:
                continue
            text = _clean("\n".join(human_parts))
            if subagent:
                # No human wrote this. It is a dispatch prompt from another
                # agent: useful as context for the assistant turns that follow,
                # never a correction, a frustration or a stated preference.
                last_user_text = text
                continue
            if INTERRUPTED in text:
                add(uuid, ts, "user", "rejection", text, last_assistant_text)
                continue
            if len(text.split()) < MIN_WORDS:
                continue
            if is_pipeline_text(text):        # guard B
                continue
            last_user_text = text
            # DEFECT 2: no keyword gate here. Every substantive human turn is a
            # candidate, so what stage 1 admits cannot correlate with length.
            for seq, seg in enumerate(segments(text)):
                add(uuid, ts, "user", "user", seg, last_assistant_text, seq)

    if since_uuid and watermark_found:
        records = [rec for seen, rec in candidates if seen]
    else:
        records = [rec for _, rec in candidates]

    summary = {
        "session_id": session_id,
        "project": project,
        "last_uuid": last_uuid,
        "candidates": len(records),
        "turns": turns,
        "lines": lines,
        "bad_lines": bad,
        "bytes": os.path.getsize(path),
        "watermark_found": watermark_found,
        "pipeline": pipeline,
        "subagent": bool(subagent),
        "agent_id": agent_id,
    }
    return records, summary


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("transcript")
    ap.add_argument("--since-uuid", default=None, help="watermark; emit only moments after this uuid")
    ap.add_argument("--session-id", default=None, help="override session id (default: filename stem)")
    ap.add_argument("--project", default=None, help="override project slug (default: parent dir name)")
    ap.add_argument("--subagent", dest="subagent", action="store_true", default=None,
                    help="force subagent mode (default: auto-detect from the path)")
    ap.add_argument("--no-subagent", dest="subagent", action="store_false",
                    help="force normal mode")
    ap.add_argument("--no-task-reports", dest="task_reports", action="store_false",
                    default=True, help="do not mine successful Task tool_results")
    ap.add_argument("--skip-captured-agents", action="store_true",
                    help="drop Task reports whose subagent transcript exists on disk "
                         "(set this when scan.py --subagents will read it directly)")
    args = ap.parse_args(argv)

    records, summary = extract(
        args.transcript, args.since_uuid, args.session_id, args.project, args.subagent,
        args.task_reports, args.skip_captured_agents,
    )
    out = sys.stdout
    for rec in records:
        out.write(json.dumps(rec, ensure_ascii=False) + "\n")
    out.flush()
    sys.stderr.write(json.dumps(summary) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
