---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: retain
  integrates:
    claude-code-hooks: [PreToolUse Bash]
    statusline: statusline-load.sh
    zsh: claude.zsh
  requires:
    commands: [sh, jq, taskpolicy]
  platforms: macOS (sysctl kern.memorystatus_vm_pressure_level)
---
# speedbump

Keeps a pile of agent sessions from locking up the Mac, in three parts:

- **Every session runs at lower priority.** `claude.zsh` starts each `claude` under the utility QoS clamp, and everything it runs inherits it. With spare cores that costs nothing; on a saturated Mac a session gets about a third of a normal process's CPU, so the apps you're using stay responsive. See [the ADR](../../docs/adr/2026-11-21-run-agent-sessions-at-utility-qos.md).
- **You can see who is costing what.** `sessions.sh` adds up each Claude session's whole process tree (CPU and memory), and [`statusline-load.sh`](../statusline/statusline-load.sh) shows it: `⚡2.4c 3.1G` for this session on its status line and herdr sidebar row, and `🔥4.7× · top: Hydra demos 3.1c` on every status line once the Mac is overloaded.
- **The heavy session waits.** When the Mac is strained, the hook holds a shell command for up to 30 seconds (less if the strain eases) only if its own session is using 2+ cores or 4+ GB, then runs it and tells the agent to stop piling on. A session is held at most once per 10 minutes. A speed bump, not a wall.

**Why only the heavy session:** until 2026-11-21 every session was held. Over 1,029 holds the commands held most were `cd` (458), `cat` (102), `grep` and `ls`, while the session running the heavy job (a `bun test` with 271 Chrome processes) went on at full size. A light session waiting does nothing for the load.

Sessions can't see each other, so each one sizes its work as if it had the whole machine. On 2026-10-16 two sessions ran the same `viz verify` side by side, each with a headless Chrome at 12x concurrency. A per-tool lock only covers tools already known to be heavy; this checks the machine itself before every Bash call, so it covers anything.

**Strained:** any one of these, each read fresh on every call, so nothing is tied to one machine's size:

- **Memory:** the kernel's memory pressure is critical. Not "percent used": macOS fills spare RAM with cache, so that is always high. Warning was the first threshold, but it fired on 2026-10-16 while nothing felt slow; Apple's kernel docs describe warning as "beginning to experience memory pressure" and critical as "expect latencies".
- **CPU:** the 1-minute load is above 1.5x the core count while the 5-minute load is above the core count (sustained, not a spike).
- **Disk:** under 10 GB free in the home volume. A fixed floor, not a percentage: builds, Docker pulls and swap need gigabytes whatever the disk size. A failed reading counts as fine.

Swap used is ignored: it stays high long after the pressure is gone. Disk I/O (needs a second of sampling) and thermal state (not reported on this Mac) were considered and left out.

**Not spammy:** when the Mac is fine, or the session is light, it prints nothing, so it costs no tokens. A session it has held is let through for the next 10 minutes. The note gives the session's own use and tags each busy process with the Claude session above it.

**Per-session use** (`sessions.sh`): a session is its topmost `claude` process, so a `claude -p` it starts is charged to it. CPU is `ps`'s decaying average (about the last minute). Memory adds each process's resident size, so pages Chrome processes share are counted more than once: read it as an upper bound. Processes that leave the tree (re-parented to launchd: Colima, daemons, a detached helper) belong to no session.

**Wait, don't block.** It used to block once and tell the agent to retry. The retry came seconds later on an equally busy Mac, so nothing slowed down, and the block reached the agent as a tool error: across 114 sessions, agents treated it as a failure, investigated the busy processes, or changed the command. Now the hook's own pause is the throttle, and the note reaches the agent as `additionalContext`, not an error. The hook `timeout` in settings.json (45) must stay above the 30-second wait; if it fires anyway, Claude Code runs the command.

**Low disk still blocks once,** with a message that says to retry: waiting can't free space, and the warning has to land before a build or download writes gigabytes. Without "run the exact same command again", an agent treats the block as final and stops to ask the user.

Each hold (with how long it waited) and each block is logged to `~/.agents/state/speedbump/log` with the readings and the command. Use it to tune the thresholds: holds while the Mac felt fine mean they are too low.

## Install

`settings/claude-code/settings.json` runs it as a `PreToolUse` hook on `Bash`. To turn it off, remove that entry.

`~/.zshrc` sources `claude.zsh` (not managed by `install.ts`; add the line by hand on a new machine):

```sh
[ -f "$HOME/.agents/ai-setup/tools/speedbump/claude.zsh" ] && source "$HOME/.agents/ai-setup/tools/speedbump/claude.zsh"
```

Sessions already running keep their priority until restarted. `command claude` starts one without the clamp.

## Test

`sh tools/speedbump/speedbump.test.sh` (about 2 s) fakes the readings through `SPEEDBUMP_SIGNALS`, the state folder through `SPEEDBUMP_STATE`, the wait through `SPEEDBUMP_WAIT`, the process table through `SESSIONS_PS` and the hook's own pid through `SPEEDBUMP_PID`.
