#!/bin/bash
# dream: Claude Code `SessionEnd` hook -- final sweep + model ENRICHMENT.
#
# Fires once per session (`/clear`, exit, logout). This is the one hook allowed
# to spend a local model call, because it adds judgment the deterministic
# prefilter structurally cannot: was the user actually frustrated, and what was
# the correction really about.
#
# TIMEOUT (measured against Claude Code 2.1.233, not assumed):
#   SESSION_END_HOOK_TIMEOUT_MS_DEFAULT = 1500 ms.
#   Verified empirically: a 5 s SessionEnd hook with no `timeout` key was killed
#   (no output file); the same hook with `"timeout": 15` completed.
#   The budget is max(1500, min(largest per-hook `timeout` * 1000, 60000)),
#   overridable by CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS. Hard ceiling 60 s.
#
# 1500 ms cannot hold an LLM call, and raising `timeout` would only trade a
# fast kill for a slow one -- either way the hook could be killed MID-WRITE.
# So we do not race the timeout at all: this script DETACHES the work and
# returns in single-digit milliseconds. Verified on 2.1.233 that a nohup'd
# child survives both the hook timeout and full Claude Code exit, so the
# enrichment finishes on its own clock and nothing is ever truncated.
#
# Still PURE OPTIMIZATION. If Ollama is down, slow, or returns garbage, the
# worker exits having written nothing. The nightly scanner is unaffected.
#
# Env:
#   DREAM_DISABLE          non-empty -> exit 0 (kill switch)
#   DREAM_NO_ENRICH        non-empty -> final prefilter sweep only, no model
#   DREAM_ENRICH_MODEL     default qwen2.5-coder:14b
#   DREAM_ENRICH_BUDGET_S  default 90 (self-imposed wall clock on the worker)
#   DREAM_ENRICH_MAX       default 12 candidates per session

[ -n "$DREAM_DISABLE" ] && exit 0

SKILL=$(cd "$(dirname "$0")/.." && pwd -P)
STATE="${DREAM_STATE:-$HOME/.agents/state/dream}"
[ -f "$STATE/.disabled" ] && exit 0

IFS= read -r -d '' HOOK_JSON

# Verified SessionEnd payload on 2.1.233:
#   session_id, transcript_path, cwd, prompt_id, hook_event_name, reason
# (Thinner than Stop: no permission_mode / effort / stop_hook_active.)
re_sid='"session_id":[[:space:]]*"([^"]*)"'
[[ $HOOK_JSON =~ $re_sid ]] || exit 0
SESSION_ID="${BASH_REMATCH[1]}"
case "$SESSION_ID" in
  ''|*/*|*..*) exit 0 ;;
esac

mkdir -p "$STATE/logs" "$STATE/.locks" "$STATE/candidates" 2>/dev/null

export DREAM_HOOK_JSON="$HOOK_JSON"
export DREAM_SESSION_ID="$SESSION_ID"
export DREAM_SKILL="$SKILL"
export DREAM_STATE="$STATE"

# Everything below runs detached. Returning now is the whole point.
(
  # (1) Final deterministic sweep. DREAM_SYNC=1 keeps it inline so the
  #     candidates file is complete before enrichment reads it;
  #     DREAM_MIN_NEW_BYTES=0 forces it regardless of the Stop watermark.
  printf '%s' "$DREAM_HOOK_JSON" | \
    DREAM_SYNC=1 DREAM_MIN_NEW_BYTES=0 DREAM_WRITER=session-end-hook \
    /bin/bash "$DREAM_SKILL/hooks/stop.sh"

  # SUPERSEDED. `scripts/score.py` now judges every stage-1 moment on Claude,
  # which the A/B measured at 11.1-11.8/12 against 4.5-6.0/12 for the local
  # model this block uses -- and it reads `state/stage1/`, where the prefilter
  # writes now, so the query below would find nothing anyway. The deterministic
  # sweep above is still worth doing at session end; this is not.
  # Set DREAM_ENRICH=1 to resurrect the old local path.
  [ -z "$DREAM_ENRICH" ] && exit 0
  [ -n "$DREAM_NO_ENRICH" ] && exit 0

  # Ollama serialises requests and holds ONE model in VRAM. cluster.py uses
  # nomic-embed-text; firing a different model here evicts it, so both jobs
  # thrash and both get slower. Observed in testing (when synthesis was still
  # local, on a 20 GB 30B): with it resident, even a 1B probe timed out after
  # 60 s. Synthesis moved to Claude on 2026-08-16 and no longer competes for the
  # GPU at all, but clustering still does. If the nightly dream holds the lock,
  # skip enrichment entirely -- the authoritative run wins the GPU, and the
  # scanner covers this session anyway.
  NIGHTLY_PID=$(cat "$DREAM_STATE/dream.lock/pid" 2>/dev/null)
  if [ -n "$NIGHTLY_PID" ] && kill -0 "$NIGHTLY_PID" 2>/dev/null; then
    echo "dream enrich: nightly run active (pid $NIGHTLY_PID), skipping" >&2
    exit 0
  fi

  # (2) Model enrichment, under its own lock and its own wall clock.
  LOCK="$DREAM_STATE/.locks/$DREAM_SESSION_ID.enrich"
  mkdir "$LOCK" 2>/dev/null || exit 0
  trap 'rm -rf "$LOCK"' EXIT

  "${DREAM_PYTHON:-python3}" - "$DREAM_SESSION_ID" <<'PYEOF'
"""Model enrichment pass for one session's candidate moments.

Adds judgment the deterministic prefilter cannot produce, then appends the
result as `source: "enrichment"` rows on the same candidates file. Localhost
Ollama only -- zero egress, per CONTRACTS.md.

Every failure path is `return`: writing nothing is always an acceptable
outcome, because the nightly scanner is the authoritative producer.
"""
import json, os, sys, time, urllib.request

SID = sys.argv[1]
STATE = os.environ["DREAM_STATE"]
MODEL = os.environ.get("DREAM_ENRICH_MODEL", "qwen2.5-coder:14b")
BUDGET = float(os.environ.get("DREAM_ENRICH_BUDGET_S", "90"))
MAX_CAND = int(os.environ.get("DREAM_ENRICH_MAX", "12"))
KINDS = {"correction", "tool_error", "rejection", "frustration",
         "preference", "positive"}
DEADLINE = time.time() + BUDGET

PROMPT = """You are reviewing moments captured from a developer's AI coding session.
For each numbered moment, judge what actually happened.

Reply with ONLY a JSON object: {"items": [...]}. One entry per moment, each:
  {"i": <moment number>,
   "kind": one of correction|tool_error|rejection|frustration|preference|positive,
   "frustrated": true or false,
   "about": "<one sentence: what the user actually wanted differently, or why
             this failed. Be concrete and specific. If nothing meaningful is
             happening, use an empty string.>"}

Omit entries you cannot judge. Do not invent detail that is not in the text.

MOMENTS:
"""


def main():
    path = os.path.join(STATE, "candidates", SID + ".jsonl")
    if not os.path.exists(path):
        return

    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass

    # Idempotent: a session can end more than once (/clear then exit). Never
    # re-enrich a moment that already has an enrichment row.
    done = {r.get("uuid") for r in rows if r.get("source") == "enrichment"}
    todo = [r for r in rows
            if r.get("source") == "prefilter" and r.get("uuid") not in done]
    if not todo:
        return
    todo = todo[-MAX_CAND:]

    parts = []
    for n, r in enumerate(todo, 1):
        parts.append("[%d] kind=%s\n%s" % (n, r.get("kind", "?"),
                                           (r.get("text") or "")[:1200]))
    prompt = PROMPT + "\n\n".join(parts)

    body = json.dumps({
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "num_predict": 900},
    }).encode("utf-8")

    remaining = DEADLINE - time.time()
    if remaining <= 5:
        return
    try:
        req = urllib.request.Request(
            "http://localhost:11434/api/generate", data=body,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=remaining) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        items = json.loads(payload.get("response") or "{}").get("items") or []
    except Exception as exc:                      # noqa: BLE001 - never fatal
        sys.stderr.write("dream enrich: %s: %s\n" % (type(exc).__name__, exc))
        return

    out = []
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            src = todo[int(item["i"]) - 1]
        except (KeyError, ValueError, TypeError, IndexError):
            continue
        about = (item.get("about") or "").strip()
        if not about:
            continue
        kind = item.get("kind")
        if kind not in KINDS:
            kind = "frustration" if item.get("frustrated") else src.get("kind")
        if kind not in KINDS:
            continue
        if item.get("frustrated") and kind == src.get("kind"):
            about = "[frustrated] " + about
        out.append({
            "session_id": SID,
            "uuid": src.get("uuid"),
            "ts": ts,
            "project": src.get("project"),
            "tool": src.get("tool", "claude-code"),
            "kind": kind,
            "text": about[:2000],
            "context": (src.get("text") or "")[:1000],
            "source": "enrichment",
        })

    if not out:
        return

    # Single append of a fully-built buffer: nothing can leave a half-written
    # JSON line behind, even if the process is killed between iterations.
    blob = "".join(json.dumps(o, ensure_ascii=False) + "\n" for o in out)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(blob)

    with open(os.path.join(STATE, "processed.tsv"), "a", encoding="utf-8") as fh:
        fh.write("%s\t%s\t%s\t%d\t%s\n" % (
            SID, ts, out[-1].get("uuid") or "", len(out), "session-end-hook"))


main()
PYEOF
) >>"$STATE/logs/hooks.log" 2>&1 &

exit 0
