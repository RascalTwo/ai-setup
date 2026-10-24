---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: retain
  integrates:
    claude-code-hooks: [PreToolUse Bash]
  requires:
    commands: [sh, jq]
  platforms: macOS (sysctl kern.memorystatus_vm_pressure_level)
---
# speedbump

Blocks an agent's shell command once when the Mac is strained, names what is hogging it, and lets the agent's retry through, along with everything else that session runs for the next 10 minutes. A speed bump, not a wall.

Sessions can't see each other, so each one sizes its work as if it had the whole machine. On 2026-10-16 two sessions ran the same `viz verify` side by side, each with a headless Chrome at 12x concurrency. A per-tool lock only covers tools already known to be heavy; this checks the machine itself before every Bash call, so it covers anything.

**Strained:** any one of these, each read fresh on every call, so nothing is tied to one machine's size:

- **Memory:** the kernel's memory pressure is critical. Not "percent used": macOS fills spare RAM with cache, so that is always high. Warning was the first threshold, but it fired on 2026-10-16 while nothing felt slow; Apple's kernel docs describe warning as "beginning to experience memory pressure" and critical as "expect latencies".
- **CPU:** the 1-minute load is above 1.5x the core count while the 5-minute load is above it (sustained, not a spike).
- **Disk:** under 10 GB free in the home volume. A fixed floor, not a percentage: builds, Docker pulls and swap need gigabytes whatever the disk size. A failed reading counts as fine.

Swap used is ignored: it stays high long after the pressure is gone. Disk I/O (needs a second of sampling) and thermal state (not reported on this Mac) were considered and left out.

**Not spammy:** when the Mac is fine it prints nothing, so it costs no tokens. A session it has stopped is let through for the next 10 minutes, which is also what makes a retry go through. The message tags each busy process with the Claude session above it, so an agent can tell when another session is already doing the same heavy work.

**The message must say to retry.** In testing, an agent blocked by a hook treated the block as final and stopped to ask the user. Without "run the exact same command again", a false alarm stalls the session instead of costing one retry.

Each block is logged to `~/.agents/state/speedbump/log` with the readings and the command. Use it to tune the thresholds: blocks while the Mac felt fine mean they are too low.

## Install

`settings/claude-code/settings.json` runs it as a `PreToolUse` hook on `Bash`. To turn it off, remove that entry.

## Test

`sh tools/speedbump/speedbump.test.sh` (under 1 s) fakes the readings through `SPEEDBUMP_SIGNALS` and the state folder through `SPEEDBUMP_STATE`.
