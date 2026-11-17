#!/usr/bin/env python3
"""Resolve a rescue target to one Claude Code session and print it as JSON.
Target: a herdr tab label (substring ok), tab id (wF:t3B), pane id (wF:p5F), or a session id.
Exit 1 with the candidates on stderr when the target is ambiguous or not a Claude session."""
import calendar, glob, json, os, re, subprocess, sys, time

def herdr(*a):
    return json.loads(subprocess.run(["herdr", *a], capture_output=True, text=True, check=True).stdout)["result"]

def transcript(sid):
    hits = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{sid}.jsonl"))
    return hits[0] if hits else None

def last_assistant_age(path):
    last = None
    for line in open(path):
        if '"type":"assistant"' in line: last = line  # keep the line, parse once
    try: ts = json.loads(last)["timestamp"]
    except (TypeError, ValueError, KeyError): return None
    t = calendar.timegm(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
    return round((time.time() - t) / 60)

def main(target):
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f-]{27}", target):
        found = [{"session_id": target, "title": "", "tab": ""}]
    else:
        tabs = {t["tab_id"]: t["label"] for t in herdr("tab", "list")["tabs"]}
        t = target.lower()
        found = []
        for a in herdr("agent", "list")["agents"]:
            label = tabs.get(a["tab_id"], "")
            if t in (a["tab_id"].lower(), a["pane_id"].lower()) or t in label.lower() or t in a.get("terminal_title_stripped", "").lower():
                if a["agent"] != "claude":
                    sys.exit(f"{label or a['tab_id']}: agent is {a['agent']}, rescue reads Claude Code transcripts only")
                found.append({"session_id": a["agent_session"]["value"], "title": a.get("terminal_title_stripped", ""), "tab": label})
    if len(found) != 1:
        sys.exit(("no session matches " if not found else "ambiguous, pick one: ") + target + "\n" + "\n".join(f"  {f['tab']:14} {f['session_id']}  {f['title']}" for f in found))
    f = found[0]
    f["transcript"] = transcript(f["session_id"])
    if not f["transcript"]:
        sys.exit(f"no transcript on disk for session {f['session_id']}")
    f["bytes"] = os.path.getsize(f["transcript"])
    f["age_minutes"] = last_assistant_age(f["transcript"])
    print(json.dumps(f))

main(sys.argv[1])
