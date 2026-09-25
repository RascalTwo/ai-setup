#!/usr/bin/env python3
"""Report agent work that was started and never finished, at session start.

WHY A HOOK AND NOT A SKILL. Writing has a natural trigger — an agent doing the
work records it. Reading has none: nothing about opening a session reminds
anybody that a previous one died halfway through a task, which is exactly the
case this whole arrangement exists for. A good intention is the wrong mechanism
for a thing that must not be forgotten.

WHAT IT DOES NOT DO: the backlog. Not "here are 43 things you could pick up" —
that is on demand, through the skill, when asked. A hook whose normal output is
a list is a hook that gets tuned out inside a week. This one's normal output is
NOTHING, and it stays silent until something is actually interrupted.

IT NEVER CLAIMS THE WORK IS DEAD. It cannot know that — another session may be
running right now. It reports what is in flight and how long ago each thing
moved, and lets the reader judge: "4 minutes ago" reads as alive, "yesterday,
14:02" reads as abandoned. That distinction cost one line of wording rather than
a liveness protocol.

FAILS OPEN, ALWAYS. Short timeout, and any failure at all — no config, plan
store unreachable, bad token, malformed document — exits 0 with no output. A
hook that hangs a session because a container stopped would be a self-inflicted
outage, and the plan store being down is a thing that actually happens.
"""
import json, os, sys, urllib.request
from datetime import datetime, timedelta

TIMEOUT_S = 2.0
CONFIG = os.path.expanduser("~/.config/timeline-studio/config.json")


def humanise(when, now):
    """How long ago, shaped so live and abandoned read differently at a glance."""
    secs = (now - when).total_seconds()
    if secs < 90:
        return "just now"
    mins = secs / 60
    if mins < 60:
        return f"{int(mins)} minutes ago"
    hours = mins / 60
    if hours < 8:
        return f"{int(hours)} hour{'' if int(hours) == 1 else 's'} ago"
    # Past a working day, the clock time is more use than the elapsed time: it is
    # what tells you this was a different sitting rather than a long one.
    if when.date() == now.date():
        return f"today, {when:%H:%M}"
    if when.date() == (now - timedelta(days=1)).date():
        return f"yesterday, {when:%H:%M}"
    return f"{when:%b %-d, %H:%M}"


def main():
    # SUBAGENTS GET NOTHING. Every Task-tool spawn fires this too, and a subagent
    # sent to grep three files does not need to hear about interrupted work it was
    # not asked to resume — it would be noise in the one place noise is expensive.
    # `agent_id` on the hook payload is what distinguishes one; the herdr hook next
    # door uses the same test.
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if raw.strip() and json.loads(raw).get("agent_id"):
        return

    with open(CONFIG) as fh:
        cfg = json.load(fh)
    req = urllib.request.Request(
        cfg["base"].rstrip("/") + "/api/plan",
        headers={"x-timeline-token": cfg["token"]},
    )
    doc = json.load(urllib.request.urlopen(req, timeout=TIMEOUT_S))["doc"]

    # Day numbers are days from `doc.start`, fractional, in local time — the same
    # origin every date in the document uses.
    origin = datetime.strptime(doc["start"], "%Y-%m-%d")
    at = lambda d: origin + timedelta(days=float(d))
    now = datetime.now()

    mine = [t for t in doc.get("tasks", []) if t.get("shape") == "ai"]
    flying = [t for t in mine if t.get("actualStart") is not None and t.get("actualEnd") is None]
    if not flying:
        return  # THE NORMAL CASE. Say nothing at all.

    # LIVENESS COMES FROM THE WHOLE CHANNEL, not from these rows. An agent part way
    # through a decomposed job is finishing SIBLINGS; the task in flight can sit
    # untouched for an hour while its pieces move. The freshest stamp anywhere in
    # the channel is the real answer to "is anyone still working".
    stamps = [float(v) for t in mine for v in (t.get("actualStart"), t.get("actualEnd")) if v is not None]

    lines = [
        "Agent work in Timeline Studio was started and never finished.",
        "Each row below is:  <task title>  (<task id>)  —  when it was started.",
        "",
    ]
    for t in sorted(flying, key=lambda t: float(t["actualStart"]), reverse=True):
        lines.append(f"  • {t.get('label') or t['id']}  ({t['id']})  — started {humanise(at(t['actualStart']), now)}")
    if stamps:
        lines.append("")
        lines.append(f"Last agent activity anywhere in the plan: {humanise(at(max(stamps)), now)}.")
    lines += [
        "",
        "Another session may still be on these. Do not pick one up unless you are",
        "deliberately resuming it, and say so when you do. The task id is what you",
        "send commands against; the title is for the human.",
    ]
    # THE DOCUMENTED SHAPE FOR A HOOK THAT ADDS CONTEXT. Public docs do not spell
    # out how SessionStart stdout reaches the model, so this uses the structured
    # form the reference does document and the install verifies it end to end
    # rather than trusting it — a hook that silently injects nothing is the exact
    # failure this whole arrangement exists to prevent.
    sys.stdout.write(json.dumps({"hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": "\n".join(lines),
    }}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Deliberately bare. There is no failure here worth interrupting a session
        # for, and no diagnostic worth printing into somebody's context.
        pass
    sys.exit(0)
