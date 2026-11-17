#!/usr/bin/env bash
# ccstatusline Custom Command widget — whether the supervisor hook has crashed lately. Nothing while it is fine;
# yellow 🛡⚠ when it crashed in the last hour, so calls went through unchecked (it fails open). The errors are in
# ~/.agents/state/supervisor/errors.log. Standalone — no shared lib; widget sets preserveColors:true.
log="${SUPERVISOR_STATE:-$HOME/.agents/state/supervisor}/errors.log"
[ -n "$(/usr/bin/find "$log" -mmin -60 2>/dev/null)" ] && printf ' \033[38;5;220m🛡⚠\033[0m'
exit 0
