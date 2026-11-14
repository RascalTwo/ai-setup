#!/bin/bash
# Runs one demo step on one side of the kelpie-park sandbox: that side's real kelpie CLI, from
# the task's run folder, with that side's plan, state and config, and the fake herdr first on PATH.
# Usage: cmd.sh <sandbox> <now|before> kelpie <args…>
S=$1 side=$2; shift 2; [ "$1" = kelpie ] && shift
D=$S/$side-side
export HOME=$D/home KELPIE_CONFIG=$D/kelpie-config KELPIE_STATE=$D/kelpie-state HERDR_LOG=$D/herdr.log
export PATH=$(cd "$(dirname "$0")/../../sandbox" && pwd):$PATH
unset HERDR_PANE_ID HERDR_ENV
cd "$KELPIE_STATE/runs/calendar/calendar-week-numbers" && bun "$S/$side/tools/kelpie/kelpie.ts" "$@" 2>&1
