# Sourced from ~/.zshrc: every `claude` started from zsh (typed, herdr tabs, spawn-herdr-tab) runs under the
# utility QoS clamp, and so does everything it starts. With spare cores it runs at full speed; when the Mac
# is saturated it gets about a third of a normal process's CPU, so the apps you're using stay responsive.
# Measured 2026-11-21 (docs/adr/2026-11-21-run-agent-sessions-at-utility-qos.md); `nice` made no difference.
# taskpolicy execs in place, so the process is still `claude` to herdr and ps. `command claude` skips this.
claude() { taskpolicy -c utility claude "$@"; }
